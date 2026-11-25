// src/lib/jobCard.ts
// ============================================================
// Fills a job card from records already saved: the Job Separation line, its
// plate, die and shade card, and the BOM. Every value says where it came
// from, and nothing is guessed — when more than one answer fits, the options
// are handed back to be picked. Pure, so the form can re-run it on each pick.
//
// PM code joins the line to plates and shade cards. Party never does: each
// table spells it differently ("UPL 03" / "UPL Ltd. A/c [Unit - 3]" / "UPL").
// ============================================================

import type { Die, FlatbedDie, JobSeparation, Plate, ShadeCard } from '@/lib/types';
import type { ArtworkRow } from '@/lib/artwork';
import { repeatLengthMm } from '@/lib/cylinders';
import { isIsoDate } from '@/lib/jobViews';
import { round2 } from '@/lib/meterCalculator';
import { LAYOUT_KEYS, colorsFrom, commonValues, dieUpsFor, flatbedDiesFor, isPlaceholderPm, materialKey, metresFromPlates, sameMaterial } from '@/lib/plateDie';

export type Source =
  | 'auto'      // saved on a linked record
  | 'calc'      // worked out from saved values
  | 'picked'    // chosen or typed on the card
  | 'last_card' // copied from the last issued card of this plate
  | 'suggested' // a hint to confirm, never final on its own
  | 'choose'    // several fit: see options
  | 'missing';  // nothing found: type it

export type Field<T> = { value: T | null; source: Source; note?: string };
export type Choice<T> = Field<T> & { options: T[] };

/** Which way the labels sit on the cylinder. Sizes and gap in mm. */
export type Layout = { across: number; around: number; acrossUps: number; aroundUps: number; aroundGap: number };

export type DieRef =
  | { type: 'ROTO';    id: string; die: Die }
  | { type: 'FLATBED'; id: string; die: FlatbedDie };

export type BomHint = { material_id: string; material_name: string; width_mm: number | null; same_line: boolean };

export type CardLine = Pick<JobSeparation, 'sr_no' | 'party' | 'po_no' | 'po_date' | 'pm_code' | 'material_name' | 'quantity' | 'cancelled_at'> & { id: string | null };

/** What a line would have given a card made by hand, typed (migration 111).
 *  `colors` only until a plate has them. */
export type ManualOrder = {
  number: string | null; party: string | null; pm_code: string | null; job_name: string | null;
  po_no: string | null; po_date: string | null; quantity: number | null; colors: (string | null)[] | null;
};

/** A typed order, where a line is expected. Its id is null: there is none yet. */
export function lineOfManual(m: ManualOrder | null | undefined): CardLine {
  return {
    id: null, sr_no: null, party: m?.party ?? '', po_no: m?.po_no ?? null, po_date: m?.po_date ?? null,
    pm_code: m?.pm_code ?? null, material_name: m?.job_name ?? null, quantity: m?.quantity ?? null, cancelled_at: null,
  };
}

export type JobCardSources = {
  line: CardLine;                // id null: a manual card not linked to a line
  linkable: (Pick<JobSeparation, 'id' | 'sr_no' | 'party' | 'po_no' | 'material_name' | 'quantity'> & { cards: number })[]; // lines it may be linked to
  plates:      Plate[];          // same PM code
  dies:        Die[];            // on those plates' cylinders, plus linked ones
  flatbedDies: FlatbedDie[];
  shadeCards:  Pick<ShadeCard, 'id' | 'product_name' | 'shade_card_number' | 'status' | 'making_status'>[]; // current, same PM code
  bom:         BomHint[];        // this line's costing first, then same PM code
  stockWidths: number[];         // paper roll widths, mm
  papers:      { name: string; specification: string | null }[]; // the paper list in use; never its rates
  cards:       JobCardRow[];     // this line's cards, by part
  lastCards:   JobCardRow[];     // issued cards of these plates, newest first
  artworks:    ArtworkRow[];     // of these plates, newest first; a removed one has no file
};

/** What a card keeps of its own: its links, and what no other record holds. */
export type JobCardInput = {
  part_name: string | null;
  plate_id: string | null; die_id: string | null; flatbed_die_id: string | null;
  shade_card_id: string | null; material_id: string | null;
  layout: Layout | null;
  roll_sheet: 'ROLL' | 'SHEET' | null; direction: string | null;
  material: string | null; material_width_mm: number | null;
  labels_per_roll: number | null; delivery_date: string | null;
  manual: ManualOrder | null;    // NULL on a card made from a line
  overrides: Partial<Record<OverrideKey, string>>;
};

/** One row of job_cards (migration 107). */
export type JobCardRow = JobCardInput & {
  id: string; job_separation_id: string | null; part: number; card_number: string | null;
  details: PrintedCard | null; issued_at: string | null; issued_by: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};

/** Boxes that can be typed over. The order's own (PO, party, qty…) are
 *  corrected on the line, and colours on the plate, so the next card has them. */
export const OVERRIDE_KEYS = ['plateNo', 'labelSize', 'cylinder', 'gap', 'metres', 'dieNumber',
  'shadeCardNumber', 'rollMetres', 'varnish'] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];

/** Widest believable paper roll: one roll is saved as 2060 mm, a typo. */
const MAX_WEB_MM = 1000;
/** Trim allowance on the material width, both edges together. */
const WIDTH_MARGIN_MM = 12;
/** Largest gap around the cylinder that still reads as a gap. ponytail: a
 *  heuristic; a real gap above this comes back "missing" and is typed. */
const MAX_GAP_MM = 12;

const VARNISHES = ['NVZ-GL', 'NVZ', 'FULL-GL', 'GLOSS'];

const num = (v: string | number | null | undefined): number => parseFloat(String(v ?? ''));

/** The layouts a plate's size, cylinder and label per round allow. A plate
 *  with its ups saved has one, as stored, if that fits the cylinder (ups can
 *  arrive from a die that counts the other way). Older plates don't agree on which
 *  size is "around" (most are the other way round), so both are tried against
 *  the cylinder: ups labels plus a 0–12 mm gap each must fill the repeat. */
export function layoutsFor(p: Plate): Layout[] {
  const rep = repeatLengthMm(p.cylinder ?? 0);
  const a = num(p.across_size), b = num(p.around_size);
  if (!(rep > 0 && a > 0 && b > 0)) return [];

  const total = p.label_per_round ?? 0;
  const out: Layout[] = [];
  const sides = a === b ? [[a, b]] : [[b, a], [a, b]]; // swapped first: the usual case
  for (const [across, around] of sides) {
    for (let ups = 1; ups <= total; ups++) {
      if (total % ups !== 0) continue;
      const gap = round2(rep / ups - around);
      if (gap >= 0 && gap <= MAX_GAP_MM) {
        out.push({ across, around, acrossUps: total / ups, aroundUps: ups, aroundGap: gap });
      }
    }
  }

  if (p.around_ups && p.across_ups) {
    const fits = round2(rep / p.around_ups - b);
    const gap = p.around_gap ?? fits;
    if (fits >= 0 && Math.abs(fits - gap) <= 0.5) {
      const stored = { across: a, around: b, acrossUps: p.across_ups, aroundUps: p.around_ups, aroundGap: gap };
      // A gap that wide usually means the sizes are the other way round: ask.
      return gap <= MAX_GAP_MM ? [stored] : [...out, stored];
    }
  }
  return out;
}

/** Height × ups + a gap between each pair + 12, then up to a width we stock. */
export function materialWidth(across: number, ups: number, gap: number | null, stock: number[]):
  { exact: number; width: number } | null {
  if (ups > 1 && gap == null) return null;
  const exact = round2(across * ups + (gap ?? 0) * (ups - 1) + WIDTH_MARGIN_MM);
  const fits = stock.filter((w) => w >= exact && w <= MAX_WEB_MM);
  return { exact, width: fits.length ? Math.min(...fits) : Math.ceil(exact) };
}

/** Metres on one finished roll (one lane): 3000 labels, 2 ups, 88T → 419.1. */
export function rollMetres(labelsPerRoll: number, aroundUps: number, cylinder: number): number | null {
  if (!(labelsPerRoll > 0 && aroundUps > 0 && cylinder > 0)) return null;
  return round2((labelsPerRoll / aroundUps) * repeatLengthMm(cylinder) / 1000);
}

/** Station list → colour boxes and the Varnish box. Order kept; stations not
 *  filled in stay as blank boxes. */
export function splitColors(colors: (string | null)[] | null, total: number | null):
  { colors: (string | null)[]; varnish: string | null } {
  const list: (string | null)[] = [...(colors ?? [])];
  while (list.length < (total ?? 0)) list.push(null);
  const isVarnish = (c: string | null) => c != null && VARNISHES.includes(c.trim().toUpperCase());
  return { colors: list.filter((c) => !isVarnish(c)), varnish: list.filter(isVarnish).join(' + ') || null };
}

/** "ROTO - 93": what the card prints. The exact die is what's saved. */
export function dieLabel(d: DieRef): string {
  return `${d.type} - ${d.die.location?.trim() || d.die.serial_no || '—'}`;
}

/** One option fills itself, several wait, a pick wins. */
function choose<T>(options: T[], picked: T | undefined, what: string): Choice<T> {
  if (picked !== undefined) return { value: picked, source: 'picked', options };
  if (options.length === 1) return { value: options[0], source: 'auto', options };
  return options.length
    ? { value: null, source: 'choose', options, note: `${options.length} ${what} fit — pick one` }
    : { value: null, source: 'missing', options };
}

/** Is `full` this material with its paper code: "AM89240 (80GSM CHROMO)" or
 *  "AM89240 80GSM CHROMO" for "80GSM CHROMO"? "80GSM CHROMO + LAMINATION" is
 *  another material, so merely containing it isn't enough. */
export function namesMaterial(full: string, material: string): boolean {
  if (sameMaterial(full, material)) return true;
  const parts = full.match(/^\s*(.*?)\s*\(([^()]*)\)\s*$/); // code (material), or material (code)
  if (parts) {
    return (sameMaterial(parts[2], material) && isPaperCode(parts[1])) || (sameMaterial(parts[1], material) && isPaperCode(parts[2]));
  }
  const [code, ...rest] = full.trim().split(/\s+-?\s*/);
  return isPaperCode(code) && sameMaterial(rest.join(' '), material);
}
// "AM89240", "SMP2239NF-1", "AM21450(INT)F": one word with a run of digits; "80GSM" is a weight.
const isPaperCode = (v: string) => /^[A-Z]*\d{3,}[A-Z0-9-]*(\([A-Z]+\)[A-Z0-9-]*)?$/i.test(v.trim()) && !/GSM$/i.test(v.trim());

/** The material in a card's wording, as a plate records it: "AM89240 (80GSM
 *  CHROMO)" → "80GSM CHROMO". Null when it names only a paper, which would
 *  match no die, unless a die is recorded under that very name. */
export function materialForPlate(full: string | null, s: Pick<JobCardSources, 'papers' | 'dies'>): string | null {
  const v = full?.trim();
  if (!v) return null;
  if (s.dies.some((d) => sameMaterial(d.material, v))) return v;
  const isPaper = (n: string) => isPaperCode(n) || s.papers.some((p) => sameMaterial(p.name, n));
  if (isPaper(v)) return null;
  const parts = v.match(/^\s*(.*?)\s*\(([^()]*)\)\s*$/);
  if (parts) {
    const [a, b] = [parts[1].trim(), parts[2].trim()];
    return a && b && isPaper(a) ? (isPaper(b) ? null : b) : a && b && isPaper(b) ? a : v;
  }
  const [code, ...rest] = v.split(/\s+-?\s*/);
  return rest.length && isPaperCode(code) ? rest.join(' ') : v;
}

/** What the Material box's list offers, grouped by where each comes from. A
 *  name is offered once, in the first group that has it. */
export function materialOptions(s: Pick<JobCardSources, 'lastCards' | 'bom' | 'dies' | 'papers'>, plate: Plate | null, die: DieRef | null):
  { group: string; names: string[] }[] {
  const own = plate?.material?.trim() || null;
  const seen = new Set<string>();
  const once = (names: (string | null | undefined)[]) => names.map((n) => n?.trim() ?? '')
    .filter((n) => n && !seen.has(n.toUpperCase()) && seen.add(n.toUpperCase()));
  const bom = s.bom.map((b) => b.material_name);
  return [
    { group: 'Plate', names: once([own]) },
    { group: 'Earlier job cards', names: once(s.lastCards.map((c) => c.material ?? (c.details?.material as string | null | undefined))) },
    // With the plate's material, the full name as the cards print it.
    { group: 'BOM costing', names: once([...(own ? bom.filter((n) => !materialKey(n).includes(materialKey(own))).map((n) => `${n} (${own})`) : []), ...bom]) },
    { group: 'Linked die', names: once([die?.type === 'ROTO' ? die.die.material : null]) },
    { group: 'Paper list', names: once(s.papers.map((p) => p.name)) },
    { group: 'Used on dies', names: once(commonValues(s.dies, 'material', 1)) },
  ].filter((g) => g.names.length > 0);
}

/** The exact die. A die linked to the plate is the answer; otherwise the ones
 *  of that size and cylinder, best first (ties: the plate's material). One match fills itself only when
 *  its ups agree with the plate (dies record them per round or across). */
function resolveDie(s: JobCardSources, plate: Plate, layout: Layout | null, dieId?: string | null): Choice<DieRef> {
  const roto = (die: Die): DieRef => ({ type: 'ROTO', id: die.id, die });
  const flat = (die: FlatbedDie): DieRef => ({ type: 'FLATBED', id: die.id, die });
  const a = plate.across_size ?? '', b = plate.around_size ?? '';
  const upsAgree = (d: Die) => d.ups != null && (d.ups === plate.label_per_round || d.ups === layout?.acrossUps);
  const rank = (d: Die) => (d.status === 'EXTRA' ? 2 : 0) + (upsAgree(d) ? 0 : 1);

  const linked = s.dies.find((d) => d.id === plate.die_id);
  const matches = dieUpsFor(s.dies, a, b, String(plate.cylinder ?? ''), plate.material).dies
    .filter((d) => d.status !== 'DAMAGE' && d.id !== linked?.id)
    .sort((x, y) => rank(x) - rank(y));
  const rotos = linked ? [linked, ...matches] : matches;
  const options = rotos.length ? rotos.map(roto) : flatbedDiesFor(s.flatbedDies, a, b).map(flat);

  const picked = dieId ? [...s.dies.map(roto), ...s.flatbedDies.map(flat)].find((o) => o.id === dieId) : undefined;
  if (picked) return { value: picked, source: 'picked', options };
  if (linked) return { value: roto(linked), source: 'auto', options };

  const only = options.length === 1 ? options[0] : null;
  if (only && (only.type === 'FLATBED' || !upsAgree(only.die))) {
    const why = only.type === 'FLATBED' ? 'Flatbed die of this size' : `Die has ${only.die.ups ?? 'no'} ups`;
    return { value: null, source: 'choose', options, note: `${why} — confirm it` };
  }
  return choose(options, undefined, 'dies');
}

export function resolveJobCard(s: JobCardSources, card: Partial<JobCardInput> = {}, cardId: string | null = null) {
  // Not linked: what's typed is the order.
  const line = s.line.id ? s.line : lineOfManual(card.manual);
  const warnings: string[] = [];
  if (line.cancelled_at) warnings.push('This line is cancelled');
  if (!line.quantity) warnings.push(line.id ? 'This line has no quantity' : 'No quantity typed');

  const field = <T,>(value: T | null | undefined, source: Source, note?: string): Field<NonNullable<T>> =>
    value == null || value === '' ? { value: null, source: 'missing', note } : { value, source, note };
  const saved = (v: string | null | undefined, note?: string) => field(v?.trim(), 'auto', note);

  // ── Plate, and how it sits on the cylinder ──
  const plateHit = choose(s.plates, s.plates.find((p) => p.id === card.plate_id), 'plates');
  const plate = plateHit.value;
  if (plateHit.source === 'missing') {
    plateHit.note = line.pm_code?.trim() && !isPlaceholderPm(line.pm_code)
      ? `No plate with PM code ${line.pm_code.trim()}` : line.id ? 'This line has no PM code' : 'No PM code typed';
  }
  const waiting = { value: null, source: 'missing' as const, note: plateHit.note, options: [] };

  // Only this plate's own issued cards: another plate of the same code may differ.
  const last = plate ? s.lastCards.find((c) => c.plate_id === plate.id) : undefined;

  // A pick counts only while the plate still allows it.
  const [ownPm, linePm] = [plate?.pm_code?.trim(), line.pm_code?.trim()];
  if (ownPm && linePm && ![ownPm, linePm].some(isPlaceholderPm) && ownPm.toLowerCase() !== linePm.toLowerCase()) {
    warnings.push(`This plate is recorded under PM code ${ownPm}`);
  }
  const layouts = plate ? layoutsFor(plate) : [];
  const same = (l: Layout | null | undefined) => l
    ? layouts.find((o) => o.across === l.across && o.around === l.around && o.aroundUps === l.aroundUps) : undefined;
  const layoutHit: Choice<Layout> = plate ? choose(layouts, same(card.layout), 'layouts') : waiting;
  const lastLayout = same(last?.layout);
  if (layoutHit.source === 'choose' && lastLayout) Object.assign(layoutHit, { value: lastLayout, source: 'last_card', note: undefined });
  if (plate && layoutHit.source === 'missing') layoutHit.note = 'Size, cylinder and label per round don’t fit together';
  const layout = layoutHit.value;
  if (plate?.label_per_round && layout && layout.acrossUps * layout.aroundUps !== plate.label_per_round) {
    warnings.push(`Ups ${layout.acrossUps} × ${layout.aroundUps} don’t make label per round ${plate.label_per_round}`);
  }

  // ── Die ──
  const die: Choice<DieRef> = plate ? resolveDie(s, plate, layout, card.die_id ?? card.flatbed_die_id) : waiting;
  if (die.source === 'choose') {
    const lastDie = [last?.die_id, last?.flatbed_die_id].find(Boolean);
    const hit = lastDie ? die.options.find((o) => o.id === lastDie) : undefined;
    if (hit) Object.assign(die, { value: hit, source: 'last_card', note: undefined });
  }
  const rotoDie = die.value?.type === 'ROTO' ? die.value.die : null;
  if (rotoDie?.status === 'DAMAGE') warnings.push('The die is marked DAMAGE');

  // ── Shade card: several rows of one number are one answer ──
  const numberOf = (c: { shade_card_number: string | null; id: string }) => c.shade_card_number?.trim() || c.id;
  const shadeOptions = s.shadeCards.filter((c, i) => s.shadeCards.findIndex((o) => numberOf(o) === numberOf(c)) === i);
  const shadeCard = choose(shadeOptions, s.shadeCards.find((c) => c.id === card.shade_card_id), 'shade cards');
  const shade = shadeCard.value;
  // Rows of one number can disagree: any not approved counts.
  const notApproved = shade && s.shadeCards.find((c) => numberOf(c) === numberOf(shade) && c.status !== 'Approved');
  if (notApproved) warnings.push(`Shade card is ${notApproved.status}`);

  // ── Worked out ──
  // The same sum and rounding as the line's "Required metres", so the card
  // and the Job Separation screen never disagree.
  // The plate is already chosen, so its own code (which may be blank) is not asked again.
  const metres = plate && line.quantity
    ? metresFromPlates([{ ...plate, pm_code: 'this' }], 'this', line.quantity).options[0]?.metres : null;
  const width = layout
    ? materialWidth(layout.across, layout.acrossUps, plate?.across_gap ?? rotoDie?.across_gap ?? null, s.stockWidths) : null;
  // Typed here, else as on this plate's last card.
  const typed = <K extends 'roll_sheet' | 'direction' | 'labels_per_roll' | 'material_width_mm'>(k: K): Field<NonNullable<JobCardInput[K]>> =>
    card[k] != null ? field(card[k], 'picked') : field(last?.[k], 'last_card', last?.card_number ?? undefined);
  const labelsPerRoll = typed('labels_per_roll');
  const perRoll = labelsPerRoll.value && layout && plate?.cylinder
    ? rollMetres(labelsPerRoll.value, layout.aroundUps, plate.cylinder) : null;
  const typedWidth = typed('material_width_mm');
  // Material: typed on this card, else the plate's own, else the last card's;
  // the BOM's only as a suggestion. What the plate overrules is said.
  // The last card's fuller wording of the plate's material is the one printed.
  const lastMaterial = last && (last.material ?? (last.details?.material as string | null | undefined) ?? null);
  const typedMaterial: Field<string> = card.material != null ? field(card.material, 'picked')
    : field(lastMaterial, 'last_card', last?.card_number ?? undefined);
  const plateOwn = plate?.material?.trim() || null;
  const plateMaterial = plateOwn && lastMaterial && namesMaterial(lastMaterial, plateOwn) ? lastMaterial : plateOwn;
  const overruled = [lastMaterial && `last card: ${lastMaterial}`, s.bom[0] && `BOM: ${s.bom[0].material_name}`]
    .find((o) => o && !sameMaterial(o.slice(o.indexOf(':') + 1), plateMaterial));
  const cardColors = card.manual?.colors;
  const stations = plate?.colors ? splitColors(plate.colors, plate.total_colors)
    : cardColors?.length ? splitColors(cardColors, cardColors.length) : null;
  const bom = s.bom[0];
  // The newest decides: once its file is removed, the plate has none.
  // With no plate it is the card's own.
  const artRow = artworkRow(s.artworks, plate?.id ?? null, cardId);
  const artwork = artRow && !artRow.removed_at ? { id: artRow.id, width: artRow.width, height: artRow.height } : null;

  const draft = {
    // Records the card links to
    plate: plateHit, layout: layoutHit, die, shadeCard,

    // Boxes. The card carries its line's own Sr. No.
    cardNumber: saved(line.sr_no),
    sepLine:    saved(line.sr_no),
    poNumber:   saved(line.po_no),
    poDate:     saved(line.po_date),
    party:      saved(line.party),
    pmCode:     saved(line.pm_code),
    jobName:    saved(line.material_name),
    labelQty:   field(line.quantity || null, 'auto'),
    plateNo:    saved(plate?.location, plateHit.note),
    plateId:    saved(plate?.plate_id), // printed above the artwork
    labelSize:  field(layout && `${layout.across} X ${layout.around}`, 'calc', layoutHit.note),
    cylinder:   field(plate?.cylinder ? `${plate.cylinder}T - ${repeatLengthMm(plate.cylinder)}` : null, 'calc', plateHit.note),
    gap:        field(layout?.aroundGap, 'calc', layoutHit.note),
    metres:     field(metres == null ? null : `${metres}+`, 'calc', plateHit.note),
    dieNumber:  field(die.value && dieLabel(die.value), die.source, die.note),
    shadeCardNumber: saved(shade?.shade_card_number, shadeCard.note),
    materialWidth: typedWidth.value != null
      ? { ...typedWidth, note: width ? `Needs ${width.exact} mm` : typedWidth.note }
      : field(width?.width, 'calc',
        width ? `Needs ${width.exact} mm` : layout ? 'Height gap not saved on the plate or die' : layoutHit.note),
    rollMetres: field(perRoll, 'calc'),
    colors:     field(stations?.colors, 'auto', plateHit.note),
    varnish:    field(stations?.varnish, 'auto', plateHit.note),
    material:   typedMaterial.value != null && (typedMaterial.source === 'picked' || !plateMaterial) ? typedMaterial
      : plateMaterial ? field(plateMaterial, 'auto', `From the plate${overruled ? ` (${overruled})` : ''}`)
      : field(bom?.material_name, 'suggested',
      bom && (bom.same_line ? 'From this line’s BOM costing' : 'From BOM costing of the same PM code')),
    rollSheet:     typed('roll_sheet'),
    direction:     typed('direction'),
    labelsPerRoll,
    deliveryDate:  field(card.delivery_date, 'picked'),
    partName:      field(card.part_name, 'picked'),
    artwork:       field(artwork, 'auto', plateHit.note),

    warnings,
  };

  // Typed over on the card: wins over everything. Gap prints as text either way.
  for (const key of OVERRIDE_KEYS) {
    const v = card.overrides?.[key]?.trim();
    if (v) Object.assign(draft, { [key]: { value: v, source: 'picked', note: draft[key].value == null ? undefined : `Was ${draft[key].value}` } });
  }
  return draft;
}

/** The artwork a card shows: its plate's newest; while the plate has none, its
 *  own (attached before a plate was picked). Else the one that expired. */
export function artworkRow(artworks: ArtworkRow[], plateId: string | null, cardId: string | null): ArtworkRow | undefined {
  const onPlate = plateId ? artworks.find((a) => a.plate_id === plateId) : undefined;
  if (onPlate && !onPlate.removed_at) return onPlate;
  return (cardId ? artworks.find((a) => a.job_card_id === cardId) : undefined) ?? onPlate;
}

export type JobCardDraft = ReturnType<typeof resolveJobCard>;

/** The number a card shows before it is issued; the database gives the same
 *  one at issue (migration 107). */
export function cardNumberOf(srNo: string | null, card: Pick<JobCardRow, 'part' | 'card_number'> & { manual?: ManualOrder | null }, cardsOnLine: number): string {
  if (card.card_number) return card.card_number;
  if (card.manual) return card.manual.number?.trim().toUpperCase() || 'No number yet';
  return `${srNo?.trim() ?? ''}${cardsOnLine > 1 || card.part > 1 ? `-${card.part}` : ''}`;
}

const PRINTED_KEYS = ['sepLine', 'poNumber', 'poDate', 'party', 'pmCode', 'jobName', 'labelQty', 'plateNo', 'plateId',
  'labelSize', 'cylinder', 'gap', 'metres', 'dieNumber', 'shadeCardNumber', 'material', 'materialWidth',
  'rollMetres', 'colors', 'varnish', 'rollSheet', 'direction', 'labelsPerRoll', 'deliveryDate', 'partName'] as const;

export type PrintedCard = Record<(typeof PRINTED_KEYS)[number], string | number | (string | null)[] | null>
  & { preparedBy: string; edited?: boolean; artwork?: { id: string; width: number; height: number } }; // edited: issued again after a reopen

/** Issuing: the card as it will print, and the columns to keep so the next
 *  card of this plate can copy them. A suggestion nobody confirmed is left out. */
export function freezeCard(d: JobCardDraft, preparedBy: string, edited = false, manual = false):
  { details: PrintedCard; columns: Partial<JobCardInput> } | { error: string } {
  if (d.plate.source === 'choose') return { error: 'Pick the plate first' };
  // A manual card may be made before everything is known.
  if (d.labelQty.value == null && !manual) return { error: 'This line has no quantity' };
  const final = (k: (typeof PRINTED_KEYS)[number]) => (d[k].source === 'suggested' ? null : d[k].value);
  const details = Object.fromEntries(PRINTED_KEYS.map((k) => [k, final(k)])) as Omit<PrintedCard, 'preparedBy' | 'edited' | 'artwork'>;
  const die = d.die.value;
  return {
    details: { ...details, preparedBy, ...(edited && { edited }), ...(d.artwork.value && { artwork: d.artwork.value }) },
    columns: {
      plate_id:       d.plate.value?.id ?? null,
      die_id:         die?.type === 'ROTO' ? die.id : null,
      flatbed_die_id: die?.type === 'FLATBED' ? die.id : null,
      shade_card_id:  d.shadeCard.value?.id ?? null,
      layout:         d.layout.value,
      roll_sheet:     d.rollSheet.value,
      direction:      d.direction.value,
      labels_per_roll: d.labelsPerRoll.value,
      // The plate's is read again next time, so a correction there is followed.
      material:       d.material.source === 'auto' ? null : final('material') as string | null,
      // Only a width someone typed: a calculated one is worked out again next time.
      material_width_mm: d.materialWidth.source === 'calc' ? null : d.materialWidth.value,
    },
  };
}

/** What a card teaches its plate, so the next order fills itself: PATCH bodies
 *  for /api/plates, in order. The database copies layout between a plate and
 *  its die (migration 101), blanks included, so a die is linked only when one
 *  side has no layout to lose or both say the same, and on its own before the gap is saved. */
export function plateUpdates(plate: Plate, die: DieRef | null, typed: { colors?: string[]; acrossGap?: number | null; material?: string | null }):
  Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const blank = (r: Pick<Plate, 'around_ups' | 'around_gap' | 'across_ups' | 'across_gap'>) =>
    r.around_ups == null && r.around_gap == null && r.across_ups == null && r.across_gap == null;
  if (typed.colors?.some((c) => c.trim())) {
    out.push({ colors: typed.colors, total_colors: typed.colors.length });
  }
  if (typed.material && !plate.material?.trim()) out.push({ material: typed.material });
  if (!plate.die_id && die?.type === 'ROTO' && (blank(plate) || blank(die.die) || LAYOUT_KEYS.every((k) => plate[k] === die.die[k]))) out.push({ die_id: die.id });
  if (typed.acrossGap != null && typed.acrossGap >= 0 && typed.acrossGap !== plate.across_gap) out.push({ across_gap: typed.acrossGap });
  return out;
}

// ── The state a line's cards are in ─────────────────────────────
export type JobCardState = 'none' | 'draft' | 'issued' | 'reopened' | 'edited';
export type CardStateRow = { card_number: string | null; issued_at: string | null; edited: string | boolean | null };

/** One card: a number is kept from the first issue on, so a numbered card
 *  that isn't issued was reopened. */
export function cardState(c: CardStateRow): JobCardState {
  if (!c.issued_at) return c.card_number ? 'reopened' : 'draft';
  return c.edited === true || c.edited === 'true' ? 'edited' : 'issued';
}

/** A line with front and back is issued only when all its cards are. */
export function lineCardState(cards: CardStateRow[]): JobCardState {
  const states = cards.map(cardState);
  return (['draft', 'reopened', 'edited', 'issued'] as const).find((s) => states.includes(s)) ?? 'none';
}

const RED = '#DC2626', AMBER = '#D97706', GREEN = '#15803D';
export const JOB_CARD_STATE: Record<JobCardState, { label: string; color: string }> = {
  none:     { label: 'Not issued',                 color: RED },
  draft:    { label: 'Draft, not issued',          color: RED },
  issued:   { label: 'Issued',                     color: GREEN },
  reopened: { label: 'Reopened, not issued again', color: AMBER },
  edited:   { label: 'Issued, edited',             color: AMBER },
};

// ── Request body → columns ──────────────────────────────────────
const UUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ID_KEYS = ['plate_id', 'die_id', 'flatbed_die_id', 'shade_card_id', 'material_id'] as const;
const TEXT_KEYS = ['part_name', 'direction', 'material'] as const;

const MANUAL_TEXT = ['number', 'party', 'pm_code', 'job_name', 'po_no'] as const;

/** The typed order of a manual card; null for a card made from a line. */
export function manualFrom(raw: unknown): ManualOrder | { error: string } | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'The order details are not valid' };
  const r = raw as Record<string, unknown>;
  const out = { po_date: null, quantity: null, colors: null } as unknown as ManualOrder;
  for (const k of MANUAL_TEXT) {
    if (r[k] != null && typeof r[k] !== 'string') return { error: `${k} must be text` };
    out[k] = ((r[k] as string | null | undefined) ?? '').trim().slice(0, k === 'number' ? 30 : 200) || null;
  }
  if (out.number && !/^[A-Z0-9][A-Z0-9 ./_-]*$/i.test(out.number)) return { error: 'A job card number has letters, digits, spaces and . / - _ only' };
  if (r.po_date != null && r.po_date !== '') {
    if (typeof r.po_date !== 'string' || !isIsoDate(r.po_date)) return { error: 'PO date must be a date' };
    out.po_date = r.po_date;
  }
  if (r.quantity != null && r.quantity !== '') {
    const n = Number(r.quantity);
    if (!Number.isInteger(n) || n <= 0 || n > 1_000_000_000) return { error: 'Quantity must be a whole number above 0' };
    out.quantity = n;
  }
  out.colors = colorsFrom(r.colors);
  return out;
}

/** Only the keys the body carries; blank clears. */
export function jobCardFrom(body: unknown): { columns: Partial<JobCardInput> } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Nothing to save' };
  const b = body as Record<string, unknown>;
  const out: Partial<JobCardInput> = {};
  const blank = (v: unknown) => v === null || v === undefined || v === '';

  for (const k of ID_KEYS) {
    if (!(k in b)) continue;
    if (!blank(b[k]) && !(typeof b[k] === 'string' && UUID.test(b[k] as string))) return { error: `${k} is not a valid id` };
    out[k] = blank(b[k]) ? null : (b[k] as string);
  }
  for (const k of TEXT_KEYS) {
    if (!(k in b)) continue;
    if (!blank(b[k]) && typeof b[k] !== 'string') return { error: `${k} must be text` };
    out[k] = blank(b[k]) ? null : (b[k] as string).trim().slice(0, 200) || null;
  }
  for (const k of ['labels_per_roll', 'material_width_mm'] as const) {
    if (!(k in b)) continue;
    const n = blank(b[k]) ? null : Number(b[k]);
    const max = k === 'labels_per_roll' ? 10_000_000 : 9999;
    if (n !== null && !(n > 0 && n <= max && (k === 'material_width_mm' || Number.isInteger(n)))) {
      return { error: k === 'labels_per_roll' ? 'Labels per roll must be a whole number above 0' : 'Material width must be a number above 0' };
    }
    out[k] = n;
  }
  if ('roll_sheet' in b) {
    if (!blank(b.roll_sheet) && b.roll_sheet !== 'ROLL' && b.roll_sheet !== 'SHEET') return { error: 'Choose Roll or Sheet' };
    out.roll_sheet = blank(b.roll_sheet) ? null : (b.roll_sheet as 'ROLL' | 'SHEET');
  }
  if ('delivery_date' in b) {
    if (!blank(b.delivery_date) && !(typeof b.delivery_date === 'string' && isIsoDate(b.delivery_date))) return { error: 'Delivery date must be a date' };
    out.delivery_date = blank(b.delivery_date) ? null : (b.delivery_date as string);
  }
  if ('layout' in b) {
    const l = b.layout as Record<string, unknown> | null;
    const keys = ['across', 'around', 'acrossUps', 'aroundUps', 'aroundGap'] as const;
    if (blank(l)) out.layout = null;
    else if (typeof l !== 'object' || keys.some((k) => !Number.isFinite(l![k] as number))) return { error: 'Layout is not valid' };
    else out.layout = Object.fromEntries(keys.map((k) => [k, l![k]])) as Layout;
  }
  if ('manual' in b) {
    const m = manualFrom(b.manual);
    if (m && 'error' in m) return m;
    out.manual = m;
  }
  if ('overrides' in b) {
    if (!b.overrides || typeof b.overrides !== 'object') return { error: 'Overrides are not valid' };
    const given = b.overrides as Record<string, unknown>;
    out.overrides = Object.fromEntries(OVERRIDE_KEYS
      .filter((k) => typeof given[k] === 'string' && (given[k] as string).trim())
      .map((k) => [k, (given[k] as string).trim().slice(0, 100)]));
  }
  return { columns: out };
}

// ── The Job Cards list ──────────────────────────────────────────
export type JobCardListRow = {
  id: string; card_number: string | null; job_separation_id: string | null; manual: ManualOrder | null; part: number; part_name: string | null;
  party: string | null; pm_code: string | null; job_name: string | null; po_no: string | null;
  issued_at: string | null; issued_by: string | null; created_at: string; edited: string | null;
  job_separations: { sr_no: string | null } | null;
};
export const JOB_CARD_LIST: string = 'id, card_number, job_separation_id, manual, part, part_name, party, pm_code, job_name, po_no, '
  + 'issued_at, issued_by, created_at, edited:details->>edited, job_separations(sr_no)';

/** The number in the list: the printed one, else the one it will get. */
export function listNumber(c: Pick<JobCardListRow, 'card_number' | 'manual' | 'job_separations'>): string | null {
  return c.card_number ?? (c.manual ? c.manual.number?.trim().toUpperCase() || null : c.job_separations?.sr_no ?? null);
}
