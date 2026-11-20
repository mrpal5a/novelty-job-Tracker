// src/lib/plateDie.ts
// A plate's label per round is its die's "Ups / repeat": the die of the same
// size and cylinder (either way round — the two sheets don't agree on which
// side is "across"). Measured on the live data: 88% of plates with such a
// die carry exactly its ups. Sizes compare on the whole millimetre, the
// same as the die search.

import type { Die, DieLayout, FlatbedDie, Plate } from '@/lib/types';
import { repeatLengthMm } from '@/lib/cylinders';
import { METER, ceilWhole } from '@/lib/meterCalculator';

export const LAYOUT_KEYS = ['around_ups', 'around_gap', 'across_ups', 'across_gap'] as const;

// "4 ups · 3.5 mm" for one direction of a layout; null when neither is recorded.
export function layoutPair(ups: number | null, gap: number | null): string | null {
  return ups == null && gap == null ? null : `${ups ?? '—'} ups · ${gap ?? '—'} mm`;
}

// Width (around) gap on a plate, worked out from the cylinder as the team
// does it: cylinder × 3.175 ÷ width ups − width size — the repeat shared by
// the labels around the cylinder, less each label's width. Null until all three are
// numbers, or when the labels wouldn't fit the repeat. Two decimals, as stored.
export function widthGapMm(cylinder: string, widthUps: string, widthSize: string): number | null {
  const teeth = parseFloat(cylinder), ups = parseFloat(widthUps), size = parseFloat(widthSize);
  if (!(teeth > 0 && ups > 0 && size > 0)) return null;
  const gap = repeatLengthMm(teeth) / ups - size;
  return gap >= 0 ? Math.round(gap * 100) / 100 : null;
}

// Request body → layout columns, for the keys the body carries. Blank or
// unreadable means not recorded; ups are whole, gaps keep their decimals.
// Out-of-range values are left for the table's CHECKs to refuse.
export function layoutFrom(body: Record<string, unknown>): Partial<DieLayout> {
  const out: Partial<DieLayout> = {};
  for (const key of LAYOUT_KEYS) {
    if (!(key in body)) continue;
    const raw = body[key];
    const n = raw === null || raw === '' ? NaN : Number(raw);
    out[key] = Number.isFinite(n) ? (key.endsWith('_ups') ? Math.trunc(n) : n) : null;
  }
  return out;
}

const mm = (v: string | number | null | undefined): number | null => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export type DieUps = {
  dies: Die[];          // matching dies, ones in use first
  ups: number | null;   // set only when every matching die agrees
  options: number[];    // the distinct ups values found
};

export function dieUpsFor(dies: Die[], sizeA: string, sizeB: string, cylinder: string): DieUps {
  const a = mm(sizeA), b = mm(sizeB), cyl = mm(cylinder);
  if (a === null || b === null || cyl === null) return { dies: [], ups: null, options: [] };
  const matched = dies
    .filter((d) => mm(d.cylinder) === cyl && sameSize(d, a, b))
    .sort((x, y) => Number(x.status === 'DAMAGE') - Number(y.status === 'DAMAGE'));
  const options = Array.from(new Set(matched.map((d) => d.ups).filter((u): u is number => u != null && u > 0)));
  return { dies: matched, ups: options.length === 1 ? options[0] : null, options };
}

function sameSize(d: { length: string | null; width: string | null }, a: number, b: number): boolean {
  const l = mm(d.length), w = mm(d.width);
  return (l === a && w === b) || (l === b && w === a);
}

// Flatbed dies have no cylinder, so the size alone (either way round) decides.
export function flatbedDiesFor(dies: FlatbedDie[], sizeA: string, sizeB: string): FlatbedDie[] {
  const a = mm(sizeA), b = mm(sizeB);
  return a === null || b === null ? [] : dies.filter((d) => sameSize(d, a, b));
}

// Pick-list for a free-text die column: the spellings already in use, most
// common first. One-offs are left out so typos ("SQAURE") aren't offered back.
export function commonValues(dies: Die[], key: 'material' | 'corner' | 'shape', min = 2): string[] {
  const counts = new Map<string, number>();
  for (const d of dies) {
    const v = d[key]?.trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts).filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

// Metres of material a Job Separation line needs, from the plates with its
// PM code: the Meter calculator's sum (cylinder × 3.175 × qty ÷ ups ÷ 1000,
// never rounded down), with ups = the plate's label per round. Plates of one
// code normally agree; when they don't (placeholder codes like "001"), each
// cylinder/ups pair is its own option, most plates first, instead of a guess.
// "N/A", "NA", "NIL", "-": typed when a line has no PM code. Shared by many
// unrelated plates, so it never picks a plate.
export const isPlaceholderPm = (code: string) => /^(n\/?a|nil|none|-+)$/i.test(code.trim());

export type MeterOption = { cylinder: number; ups: number; metres: number; plates: Plate[] };

export function metresFromPlates(plates: Plate[], pmCode: string, qty: number):
  { found: number; options: MeterOption[] } {
  const want = pmCode.trim().toLowerCase();
  const same = want && !isPlaceholderPm(want) ? plates.filter((p) => p.pm_code?.trim().toLowerCase() === want) : [];
  const byPair = new Map<string, MeterOption>();
  for (const p of same) {
    const cylinder = p.cylinder ?? 0, ups = p.label_per_round ?? 0;
    if (!(cylinder > 0 && ups > 0 && qty > 0)) continue;
    const key = `${cylinder}/${ups}`;
    const hit = byPair.get(key);
    if (hit) { hit.plates.push(p); continue; }
    const solved = METER.solve({ qty, cyl: cylinder, ups }, 'metres');
    if ('value' in solved) byPair.set(key, { cylinder, ups, metres: ceilWhole(solved.value), plates: [p] });
  }
  return { found: same.length, options: Array.from(byPair.values()).sort((a, b) => b.plates.length - a.plates.length) };
}
