import { describe, it, expect } from 'vitest';
import { artworkRow, resolveJobCard, layoutsFor, materialWidth, rollMetres, labelsPerRollFor, splitColors, dieLabel, jobCardFrom, freezeCard, lineOfManual, manualFrom, namesMaterial, cardNumberOf, plateUpdates, lineCardState, type JobCardRow, type JobCardSources } from './jobCard';
import type { Die, Plate } from '@/lib/types';

// CENTURION EZ-100 ML, as saved on 2026-11-25, against the printed card.
const plate = (over: Partial<Plate> = {}): Plate => ({
  id: 'p1', die_id: null, total_colors: null, colors: null, party: 'UPL Ltd. A/c [Unit - 3]',
  pm_code: '2000000081', item_name: 'CENTURION EZ-100 ML BOTTLE LABEL_IN - 2000000081',
  across_size: '132', around_size: '70', cylinder: 88, material: null, direction: null, roll_sheet: null, plate_id: '26AG06159', plate_date: '2026-03-16',
  label_per_round: 6, location: '3008', created_by: null, created_at: '', updated_at: '',
  around_ups: null, around_gap: null, across_ups: null, across_gap: null, ...over,
});
const die = (id: string, ups: number | null, over: Partial<Die> = {}): Die => ({
  id, job_name: 'AUTO ENTRY', length: '70', width: '132', cylinder: 88, material: null, ups, gap: null,
  shape: null, corner: null, serial_no: null, die_received_on: null, location: '93', status: 'IN USE',
  damage_date: null, damage_reason: null, created_by: null, created_at: '', updated_at: '',
  around_ups: null, around_gap: null, across_ups: null, across_gap: null, ...over,
});
const shade = (id: string, number: string, status: 'Approved' | 'Pending Approval' = 'Approved') =>
  ({ id, product_name: 'CENTURION', shade_card_number: number, status, making_status: 'Already Made' as const });

const centurion = (over: Partial<JobCardSources> = {}): JobCardSources => ({
  line: { id: 'l1', sr_no: 'APR26-113', party: 'UPL 03', po_no: '5000430643', po_date: '2026-04-06',
    pm_code: '2000000081', material_name: 'CENTURION EZ-100 ML BOTTLE LABEL_IN', quantity: 631010, cancelled_at: null },
  plates: [plate()],
  dies: [die('four', 4, { across_gap: 5 }), die('spare', 2, { status: 'EXTRA', location: null }), die('three', 3)],
  flatbedDies: [], shadeCards: [shade('s1', '2592')], bom: [], cards: [], lastCards: [], artworks: [], linkable: [], ...over,
});

describe('CENTURION job card', () => {
  it('fills what the printed card shows', () => {
    const c = resolveJobCard(centurion(), { labels_per_roll: 3000 });
    expect(c.cardNumber.value).toBe('APR26-113');
    expect(c.labelSize.value).toBe('70 X 132'); // saved the other way round
    expect(c.cylinder.value).toBe('88T - 279.4');
    expect(c.gap.value).toBe(7.7);
    expect(c.rollMetres.value).toBe(419.1);
    expect(c.shadeCardNumber.value).toBe('2592');
    expect(c.plateNo.value).toBe('3008');
    // 29,384.03 rounds up as on the Job Separation screen; the old card cut it to 29384.
    expect(c.metres.value).toBe('29385+');
    expect(c.warnings).toEqual([]);
  });

  it('offers its three dies, the one whose ups agree first, the spare last', () => {
    const c = resolveJobCard(centurion());
    expect(c.die.source).toBe('choose');
    expect(c.die.options.map((o) => o.id)).toEqual(['three', 'four', 'spare']);
    expect(c.dieNumber.value).toBeNull();
    expect(resolveJobCard(centurion(), { die_id: 'three' }).dieNumber.value).toBe('ROTO - 93');
  });

  it('leaves the width blank until a gap is known, then rounds it up', () => {
    expect(resolveJobCard(centurion(), { die_id: 'three' }).materialWidth.value).toBeNull();
    const c = resolveJobCard(centurion({ plates: [plate({ across_gap: 5 })] }));
    expect(c.materialWidth).toMatchObject({ value: 235, note: 'Needs 232 mm' });
  });
});

describe('which size goes around the cylinder', () => {
  it('trusts a plate with its ups saved', () => {
    const p = plate({ across_size: '20', around_size: '80', cylinder: 78, label_per_round: 18,
      across_ups: 6, around_ups: 3, around_gap: 2.55, across_gap: 5 });
    expect(layoutsFor(p)).toEqual([{ across: 20, around: 80, acrossUps: 6, aroundUps: 3, aroundGap: 2.55 }]);
  });

  it('does not trust ups that contradict the cylinder', () => {
    // Copied from a die counting the other way: 3 × 132 can't go round 279.4.
    expect(layoutsFor(plate({ across_ups: 2, around_ups: 3, around_gap: 7.7 }))).toEqual(
      [{ across: 70, around: 132, acrossUps: 3, aroundUps: 2, aroundGap: 7.7 }]);
    // The plate form's own auto gap on swapped sizes: 23.13 is offered, not assumed.
    expect(layoutsFor(plate({ across_ups: 2, around_ups: 3, around_gap: 23.13 })).map((l) => l.aroundGap)).toEqual([7.7, 23.13]);
  });

  it('asks when both ways fit, and is blank when neither does', () => {
    // 1 up on 88T (279.4): 270 leaves 9.4, 275 leaves 4.4.
    const both = plate({ across_size: '270', around_size: '275', label_per_round: 1 });
    const c = resolveJobCard(centurion({ plates: [both] }));
    expect(c.layout.source).toBe('choose');
    expect(c.labelSize.value).toBeNull();
    const l = layoutsFor(both)[1];
    expect(resolveJobCard(centurion({ plates: [both] }), { layout: l }).labelSize.value).toBe('270 X 275');
    expect(layoutsFor(plate({ label_per_round: 7 }))).toEqual([]);
    expect(layoutsFor(plate({ cylinder: null }))).toEqual([]);
    // A square label has one answer, not two.
    expect(layoutsFor(plate({ across_size: '275', around_size: '275', label_per_round: 1 }))).toHaveLength(1);
  });
});

describe('links', () => {
  it('waits when several plates share the code, and fills after the pick', () => {
    const s = centurion({ plates: [plate(), plate({ id: 'p2', location: '12' })] });
    expect(resolveJobCard(s).plate.source).toBe('choose');
    expect(resolveJobCard(s).plateNo.value).toBeNull();
    expect(resolveJobCard(s, { plate_id: 'p2' }).plateNo.value).toBe('12');
  });

  it('uses the linked die over matches, and warns when it is damaged', () => {
    const c = resolveJobCard(centurion({
      plates: [plate({ die_id: 'three' })], dies: [die('four', 4), die('three', 3, { status: 'DAMAGE' })],
    }));
    expect(c.die.value?.id).toBe('three');
    expect(c.warnings).toContain('The die is marked DAMAGE');
  });

  it('fills a lone die only when its ups agree', () => {
    expect(resolveJobCard(centurion({ dies: [die('three', 3)] })).die.source).toBe('auto');
    expect(resolveJobCard(centurion({ dies: [die('two', 2)] })).die.source).toBe('choose');
    expect(resolveJobCard(centurion({ dies: [] })).die.source).toBe('missing');
  });

  it('treats rows of one shade card number as one, and warns if any is not approved', () => {
    const c = resolveJobCard(centurion({ shadeCards: [shade('a', '2592'), shade('b', '2592 ', 'Pending Approval')] }));
    expect(c.shadeCardNumber.value).toBe('2592');
    expect(c.warnings).toEqual(['Shade card is Pending Approval']);
    expect(resolveJobCard(centurion({ shadeCards: [shade('a', '1'), shade('b', '2')] })).shadeCard.source).toBe('choose');
  });

  it('says why there is no plate', () => {
    const s = centurion({ plates: [] });
    expect(resolveJobCard(s).plate.note).toMatch(/No plate with PM code/);
    expect(resolveJobCard({ ...s, line: { ...s.line, pm_code: 'N/A' } }).plate.note).toMatch(/no PM code/);
  });
});

describe('worked-out boxes', () => {
  it('material width: gaps between labels + 12, up to a multiple of 5', () => {
    expect(materialWidth(20, 6, 5)).toEqual({ exact: 157, width: 160 });  // MIARCO
    expect(materialWidth(195, 1, null)).toEqual({ exact: 207, width: 210 });
    expect(materialWidth(198, 1, null)).toEqual({ exact: 210, width: 210 });
    expect(materialWidth(198.1, 1, null)).toEqual({ exact: 210.1, width: 215 });
    expect(materialWidth(70, 3, null)).toBeNull();
  });

  it('labels per roll: the most hundreds within 400 m', () => {
    expect(labelsPerRollFor(2, 88)).toBe(2800);
    for (let cyl = 60; cyl <= 180; cyl++) for (let ups = 1; ups <= 6; ups++) {
      const n = labelsPerRollFor(ups, cyl)!;
      expect(n % 100).toBe(0);
      expect(rollMetres(n, ups, cyl)!).toBeLessThanOrEqual(400);
      expect(rollMetres(n + 100, ups, cyl)!).toBeGreaterThan(400);
    }
    const auto = resolveJobCard(centurion());
    expect(auto.labelsPerRoll).toMatchObject({ value: 2800, source: 'calc' });
    expect(auto.rollMetres.value).toBe(391.16);
    const sheet = resolveJobCard(centurion(), { roll_sheet: 'SHEET', labels_per_roll: 500 });
    expect([sheet.labelsPerRoll.value, sheet.rollMetres.value]).toEqual([500, '-']);
    expect(resolveJobCard(centurion(), { roll_sheet: 'SHEET' }).labelsPerRoll.value).toBeNull();
    // Typed over 400 m stands, but says so.
    expect(resolveJobCard(centurion(), { labels_per_roll: 3000 }).labelsPerRoll)
      .toMatchObject({ value: 3000, source: 'picked', note: 'Over 400 m a roll: 2800 fit' });
    expect(resolveJobCard(centurion({ plates: [] })).labelsPerRoll.value).toBeNull();
  });

  it('splits varnish out of the stations and keeps unfilled ones', () => {
    expect(splitColors(['CYAN', 'BLACK', 'WHITE', 'nvz-gl'], 4)).toEqual({ colors: ['CYAN', 'BLACK', 'WHITE'], varnish: 'nvz-gl' });
    expect(splitColors(['NVZ MATT', 'FULL-UV', 'WHITE', 'FULL GL'], 4)).toEqual({ colors: ['WHITE'], varnish: 'NVZ MATT + FULL-UV + FULL GL' });
    expect(splitColors(['GLOSS', 'TEXTURE', 'RELEASE'], 4)).toEqual({ colors: ['TEXTURE', 'RELEASE', null], varnish: 'GLOSS' });
    expect(splitColors(['CYAN', 'Lamination', 'LAMINATE MATT'], 3)).toEqual({ colors: ['CYAN'], varnish: 'Lamination + LAMINATE MATT' });
  });

  it('roll metres and die label', () => {
    expect(rollMetres(0, 2, 88)).toBeNull();
    expect(dieLabel({ type: 'ROTO', id: 'x', die: die('x', 1, { location: ' ', serial_no: 'BNK1' }) })).toBe('ROTO - BNK1');
  });
});

describe('saving and repeating', () => {
  const last = (over: Partial<JobCardRow> = {}): JobCardRow => ({
    id: 'c1', job_separation_id: 'old', part: 1, card_number: 'OCT26-9', part_name: null,
    manual: null, plate_id: 'p1', die_id: 'three', flatbed_die_id: null, shade_card_id: null, material_id: null, layout: null,
    roll_sheet: 'ROLL', direction: 'UNWIND#3', material: 'AM89240 (80GSM CHROMO)', material_width_mm: 235,
    labels_per_roll: 3000, delivery_date: '2026-10-01', overrides: { plateNo: 'NEW R' }, details: null,
    issued_at: '2026-10-01', issued_by: null, accepted_at: null, accepted_by: null, edit_request: null, created_by: null, created_at: '', updated_at: '', ...over,
  });

  it('a repeat order fills itself from the last card, but not its date or typed-over boxes', () => {
    const c = resolveJobCard(centurion({ lastCards: [last()] }));
    expect(c.dieNumber.value).toBe('ROTO - 93');
    expect(c.rollSheet).toMatchObject({ value: 'ROLL', source: 'last_card', note: 'OCT26-9' });
    expect(c.direction.value).toBe('UNWIND#3');
    expect(c.material.value).toBe('AM89240 (80GSM CHROMO)');
    expect(c.materialWidth.value).toBe(235);
    // 3000 is 419.1 m: past the limit, so not followed.
    expect(c.labelsPerRoll).toMatchObject({ value: 2800, source: 'calc' });
    expect(resolveJobCard(centurion({ lastCards: [last({ labels_per_roll: 2000 })] })).labelsPerRoll)
      .toMatchObject({ value: 2000, source: 'last_card', note: 'OCT26-9' });
    expect(c.deliveryDate.value).toBeNull();
    expect(c.plateNo.value).toBe('3008');
  });

  it('direction: this card’s pick, then the plate’s, then the last card’s; roll or sheet the same way', () => {
    const s = centurion({ plates: [plate({ direction: 'UNWIND#1', roll_sheet: 'SHEET' })], lastCards: [last()] }); // last says #3
    const c = resolveJobCard(s);
    expect(c.direction).toMatchObject({ value: 'UNWIND#1', source: 'auto', note: 'From the plate' });
    expect(c.rollSheet).toMatchObject({ value: 'SHEET', source: 'auto', note: 'From the plate' });
    expect(c.labelsPerRoll).toMatchObject({ value: 3000, source: 'last_card' });
    const f = freezeCard(c, 'x');
    if ('error' in f) throw new Error(f.error);
    expect(f.details).toMatchObject({ direction: 'UNWIND#1', rollSheet: 'SHEET' });
    expect(f.columns).toMatchObject({ direction: null, roll_sheet: null }); // read from the plate again
    expect(resolveJobCard(s, { direction: 'UNWIND#2', roll_sheet: 'ROLL' })).toMatchObject({
      direction: { value: 'UNWIND#2', source: 'picked', note: 'For this card only. The plate says UNWIND#1' }, rollSheet: { value: 'ROLL', note: 'For this card only. The plate says SHEET' } });
    expect(resolveJobCard(centurion()).rollSheet.value).toBeNull();
    // A plate without one learns it; a saved one, or one that isn't used, is left alone.
    expect(plateUpdates(plate(), null, { direction: 'UNWIND#3' })).toEqual([{ direction: 'UNWIND#3' }]);
    expect(plateUpdates(plate({ direction: 'UNWIND#1' }), null, { direction: 'UNWIND#3' })).toEqual([]);
    expect(plateUpdates(plate(), null, { direction: 'UNWIND#7' })).toEqual([]);
    expect(plateUpdates(plate(), null, { rollSheet: 'ROLL' })).toEqual([{ roll_sheet: 'ROLL' }]);
    expect(plateUpdates(plate({ roll_sheet: 'ROLL' }), null, { rollSheet: 'SHEET' })).toEqual([]);
  });

  it('never copies another plate’s card, and typing wins', () => {
    expect(resolveJobCard(centurion({ lastCards: [last({ plate_id: 'other' })] })).direction.value).toBeNull();
    const c = resolveJobCard(centurion({ lastCards: [last()] }), { direction: 'UNWIND#4', overrides: { plateNo: 'NEW R', gap: '7.70' } });
    expect(c.direction).toMatchObject({ value: 'UNWIND#4', source: 'picked' });
    expect(c.plateNo).toMatchObject({ value: 'NEW R', note: 'Was 3008' });
    expect(c.gap.value).toBe('7.70');
  });

  it('issues what was filled, keeps it for next time, leaves unconfirmed hints out', () => {
    const bom = [{ material_id: 'm', material_name: 'BMB1450', width_mm: 170, same_line: true }];
    const f = freezeCard(resolveJobCard(centurion({ bom, dies: [die('three', 3)], plates: [plate({ across_gap: 5 })] }), { direction: 'UNWIND#3' }), 'vibhuti');
    if ('error' in f) throw new Error(f.error);
    expect(f.details).toMatchObject({ gap: 7.7, metres: '29385+', dieNumber: 'ROTO - 93', materialWidth: 235, material: null, plateId: '26AG06159', preparedBy: 'vibhuti' });
    expect(f.columns).toMatchObject({ plate_id: 'p1', die_id: 'three', direction: 'UNWIND#3', material: null, material_width_mm: null, labels_per_roll: null });
    expect(f.details).toMatchObject({ labelsPerRoll: 2800, rollMetres: 391.16 });
    expect(freezeCard(resolveJobCard(centurion({ plates: [plate(), plate({ id: 'p2' })] })), 'x')).toEqual({ error: 'Pick the plate first' });
  });

  it('numbers: the Sr. No. alone, a part when there are several, the issued one forever', () => {
    expect(cardNumberOf('NOV26-55', { part: 1, card_number: null }, 1)).toBe('NOV26-55');
    expect(cardNumberOf('NOV26-55', { part: 1, card_number: null }, 2)).toBe('NOV26-55-1');
    expect(cardNumberOf('NOV26-55', { part: 2, card_number: null }, 1)).toBe('NOV26-55-2');
    expect(cardNumberOf('NOV26-55', { part: 1, card_number: 'NOV26-55' }, 2)).toBe('NOV26-55');
  });

  it('reads a request body: only known keys, blanks clear, bad values refused', () => {
    expect(jobCardFrom({ direction: ' UNWIND#3 ', labels_per_roll: '3000', delivery_date: '', card_number: 'X', issued_at: 'now', overrides: { gap: '7', party: 'X' } }))
      .toEqual({ columns: { direction: 'UNWIND#3', labels_per_roll: 3000, delivery_date: null, overrides: { gap: '7' } } });
    for (const bad of [null, { plate_id: '1 or 1=1' }, { labels_per_roll: 2.5 }, { material_width_mm: -1 }, { roll_sheet: 'BOX' },
      { delivery_date: '31-12-2026' }, { layout: { across: 'x' } }, { material: 5 }]) {
      expect(jobCardFrom(bad)).toHaveProperty('error');
    }
  });

  it('teaches the plate without wiping a die: link first and alone, gap after', () => {
    const roto = (d: Die) => ({ type: 'ROTO' as const, id: d.id, die: d });
    expect(plateUpdates(plate(), roto(die('three', 3)), { colors: ['CYAN', 'NVZ-GL'], acrossGap: 5 })).toEqual([
      { colors: ['CYAN', 'NVZ-GL'], total_colors: 2 }, { die_id: 'three' }, { across_gap: 5 }]);
    const full = roto(die('full', 6, { around_ups: 2, around_gap: 7.7, across_ups: 3, across_gap: 5 }));
    expect(plateUpdates(plate({ across_gap: 4 }), full, {})).toEqual([]);   // would blank the die's ups
    expect(plateUpdates(plate({ around_ups: 2, around_gap: 7.7, across_ups: 3, across_gap: 5 }), full, {})).toEqual([{ die_id: 'full' }]); // agree
    expect(plateUpdates(plate(), full, {})).toEqual([{ die_id: 'full' }]);  // the plate takes the die's
    expect(plateUpdates(plate({ die_id: 'x' }), full, { colors: ['', ' '], acrossGap: null })).toEqual([]);
  });

  it('a line is green only when every card is issued, amber once edited, red before', () => {
    const none = { card_number: null, issued_at: null, accepted_at: null, edited: null };
    const issued = { card_number: 'N-1', issued_at: 'x', accepted_at: null, edited: null };
    const reopened = { card_number: 'N-1', issued_at: null, accepted_at: null, edited: null };
    const edited = { card_number: 'N-1', issued_at: 'x', accepted_at: null, edited: 'true' }; // as Postgres hands it back
    expect(lineCardState([])).toBe('none');
    expect(lineCardState([issued])).toBe('issued');
    expect(lineCardState([issued, issued])).toBe('issued');
    expect(lineCardState([issued, none])).toBe('draft');
    expect(lineCardState([issued, edited])).toBe('edited');
    expect(lineCardState([edited, reopened])).toBe('reopened');
    const accepted = { ...edited, accepted_at: 'y' };
    expect(lineCardState([accepted, accepted])).toBe('accepted');
    expect(lineCardState([accepted, issued])).toBe('issued');
    const asked = { ...edited, edit_request: { note: 'Die 93', by: 'production', at: 'z' } };
    expect(lineCardState([asked, edited, accepted])).toBe('asked');
    expect(lineCardState([asked, reopened])).toBe('reopened');
    expect(lineCardState([{ ...reopened, edit_request: asked.edit_request }])).toBe('reopened'); // being changed
  });

  it('marks a card issued again as edited, the first issue not', () => {
    const d = resolveJobCard(centurion());
    const first = freezeCard(d, 'x'), again = freezeCard(d, 'x', true);
    expect('details' in first && first.details.edited).toBe(undefined);
    expect('details' in again && again.details.edited).toBe(true);
  });
});

describe('artwork', () => {
  const art = (id: string, over = {}) => ({ id, plate_id: 'p1', job_card_id: null, path: id, file_name: 'A.pdf', width: 1528, height: 1270, bytes: 1,
    created_by: null, created_at: '', last_used_at: '', removed_at: null, ...over });
  const issue = (artworks: ReturnType<typeof art>[]) => {
    const f = freezeCard(resolveJobCard(centurion({ artworks })), 'x');
    if ('error' in f) throw new Error(f.error);
    return f.details.artwork;
  };
  it('is frozen with the card: the plate’s newest', () => {
    expect(issue([art('new'), art('old')])).toEqual({ id: 'new', width: 1528, height: 1270 });
  });
  it('is none when the newest was removed, belongs to another plate, or there is none', () => {
    expect(issue([art('new', { removed_at: '2026-01-01' }), art('old')])).toBeUndefined();
    expect(issue([art('other', { plate_id: 'p2' })])).toBeUndefined();
    expect(issue([])).toBeUndefined();
  });
});

describe('material from the plate', () => {
  const bom = [{ material_id: 'm', material_name: 'BMB1450', width_mm: 170, same_line: true }];
  const on = (material: string | null, over: Partial<JobCardSources> = {}) => centurion({ plates: [plate({ material })], ...over });
  const lastCard = { plate_id: 'p1', material: 'AM89240 (80GSM CHROMO)', issued_at: 'x', card_number: 'OCT26-1' } as unknown as JobCardRow;

  it('beats the last card, says what it overruled, and never takes BOM’s material', () => {
    expect(resolveJobCard(on('80GSM CHROMO')).material).toMatchObject({ value: '80GSM CHROMO', source: 'auto', note: 'From the plate' });
    expect(resolveJobCard(on('PP WHITE', { lastCards: [lastCard], bom })).material).toMatchObject({ value: 'PP WHITE', note: 'From the plate (last card: AM89240 (80GSM CHROMO))' });
    expect(resolveJobCard(on('PP WHITE', { bom })).material.note).toBe('From the plate');
  });
  it('gives way to one typed on the card', () => {
    expect(resolveJobCard(on('PP WHITE'), { material: 'TC60' }).material).toMatchObject({ value: 'TC60', source: 'picked' });
  });
  it('without one, all is as before', () => {
    expect(resolveJobCard(on(null, { lastCards: [lastCard], bom })).material).toMatchObject({ value: 'AM89240 (80GSM CHROMO)', source: 'last_card' });
    expect(resolveJobCard(on('  ', { bom })).material.value).toBeNull();
  });
  it('prints, but is not copied onto the card: a reopened one follows the plate', () => {
    const f = freezeCard(resolveJobCard(on('PP WHITE')), 'x');
    if ('error' in f) throw new Error(f.error);
    expect([f.details.material, f.columns.material]).toEqual(['PP WHITE', null]);
  });
});

describe('the material’s full name', () => {
  it('is the plate’s material with a paper code, never a different material', () => {
    for (const full of ['AM89240 (80GSM CHROMO)', 'am89240f ( 80 gsm chromo )', '80GSM CHROMO (AM89240)', 'AM89240 80GSM CHROMO', 'AM89240 - 80GSM CHROMO', 'AM21450(INT)F (80GSM CHROMO)', '80GSM CHROMO']) {
      expect([full, namesMaterial(full, '80GSM CHROMO')]).toEqual([full, true]);
    }
    for (const other of ['80GSM CHROMO + LAMINATION', 'AM89240 (80GSM CHROMO + LAMINATION)', '80GSM CHROMO SILVER', 'AM89240', '120GSM 80GSM CHROMO', '80GSM CHROMO (217 X 82 - 3 UPS)', 'PP WHITE']) {
      expect([other, namesMaterial(other, '80GSM CHROMO')]).toEqual([other, false]);
    }
  });
  const on = (last: Record<string, unknown>) => resolveJobCard(centurion({
    plates: [plate({ material: '80GSM CHROMO' })],
    lastCards: [{ plate_id: 'p1', issued_at: 'x', card_number: 'OCT26-1', material: null, ...last } as unknown as JobCardRow],
  })).material;
  it('prints from the last card, also when that card had it from the plate', () => {
    expect(on({ material: 'AM89240 (80GSM CHROMO)' })).toMatchObject({ value: 'AM89240 (80GSM CHROMO)', source: 'auto', note: 'From the plate' });
    expect(on({ details: { material: 'AM89240 (80GSM CHROMO)' } }).value).toBe('AM89240 (80GSM CHROMO)');
    expect(on({ material: 'PP WHITE' })).toMatchObject({ value: '80GSM CHROMO', note: 'From the plate (last card: PP WHITE)' });
  });
});


describe('cards made by hand', () => {
  const manual = (over = {}) => ({ number: 'JC-7', party: 'ACME', pm_code: '2000000081', job_name: 'NEW JOB', po_no: null, po_date: null, quantity: 1000, colors: null, ...over });
  const alone = { ...centurion(), line: lineOfManual(null) };

  it('fills from what is typed, live, and finds the plate by its PM code', () => {
    const d = resolveJobCard(alone, { manual: manual() });
    expect([d.party.value, d.jobName.value, d.labelQty.value, d.sepLine.value, d.plate.value?.id]).toEqual(['ACME', 'NEW JOB', 1000, null, 'p1']);
  });
  it('linked, the order is the line’s', () => {
    expect(resolveJobCard(centurion(), { manual: manual() }).jobName.value).toBe('CENTURION EZ-100 ML BOTTLE LABEL_IN');
  });
  it('with no plate, keeps its own colours and artwork, and can be issued without a quantity', () => {
    const art = { id: 'a', plate_id: null, job_card_id: 'card', path: 'x', file_name: 'f', width: 10, height: 5, bytes: 1, created_by: null, created_at: '', last_used_at: '', removed_at: null };
    const s = { ...alone, plates: [], artworks: [art] };
    const m = manual({ quantity: null, colors: ['CYAN', 'NVZ-GL'] });
    const d = resolveJobCard(s, { manual: m }, 'card');
    expect([d.colors.value, d.varnish.value, d.artwork.value?.id]).toEqual([['CYAN'], 'NVZ-GL', 'a']);
    expect(resolveJobCard(s, { manual: m }, 'another card').artwork.value).toBeNull();
    expect(resolveJobCard(s, { manual: m }).artwork.value).toBeNull();
    expect('details' in freezeCard(d, 'x', false, true)).toBe(true);
    expect(freezeCard(d, 'x')).toEqual({ error: 'This line has no quantity' }); // a line still needs one
  });
  it('shows the typed number until it is issued', () => {
    expect(cardNumberOf(null, { part: 1, card_number: null, manual: manual({ number: ' jc-7 ' }) }, 1)).toBe('JC-7');
    expect(cardNumberOf(null, { part: 1, card_number: null, manual: manual({ number: null }) }, 1)).toBe('No number yet');
    expect(cardNumberOf('NOV26-55', { part: 2, card_number: 'JC-7', manual: manual() }, 2)).toBe('JC-7');
  });
  it('checks what is typed', () => {
    expect(manualFrom({ number: ' JC 7/A ', job_name: ' X ', quantity: '1000', po_date: '2026-11-25', party: '' }))
      .toEqual({ number: 'JC 7/A', party: null, pm_code: null, job_name: 'X', po_no: null, po_date: '2026-11-25', quantity: 1000, colors: null });
    expect(manualFrom(null)).toBeNull();
    for (const bad of ['x', [], { number: '<b>' }, { number: 7 }, { quantity: -1 }, { quantity: 1.5 }, { po_date: '25-11-2026' }]) {
      expect(manualFrom(bad)).toHaveProperty('error');
    }
  });
});

describe('a plate picked by hand', () => {
  const other = plate({ id: 'other', pm_code: '9999' });
  it('is used though its PM code differs, and that is said', () => {
    const d = resolveJobCard(centurion({ plates: [plate(), other] }), { plate_id: 'other' });
    expect([d.plate.value?.id, d.warnings]).toEqual(['other', ['This plate is recorded under PM code 9999']]);
    expect(resolveJobCard(centurion()).warnings).toEqual([]);
  });
  it('artwork attached before it was picked shows until the plate has its own', () => {
    const row = (id: string, o: object) => ({ id, plate_id: null, job_card_id: null, path: id, file_name: 'f', width: 1, height: 1, bytes: 1, created_by: null, created_at: '', last_used_at: '', removed_at: null, ...o });
    const card = row('card', { job_card_id: 'c' }), plates = row('plate', { plate_id: 'p' }), gone = row('gone', { plate_id: 'p', removed_at: 'x' });
    const id = (list: ReturnType<typeof row>[], p: string | null = 'p') => artworkRow(list, p, 'c')?.id;
    expect([id([card]), id([card, plates]), id([gone, card]), id([gone]), id([plates], null), id([card], null)]).toEqual(['card', 'plate', 'card', 'gone', undefined, 'card']);
  });
});
