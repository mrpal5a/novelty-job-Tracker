// src/lib/plateDie.ts
// A plate's label per round is its die's "Ups / repeat": the die of the same
// size and cylinder (either way round — the two sheets don't agree on which
// side is "across"). Measured on the live data: 88% of plates with such a
// die carry exactly its ups. Sizes compare on the whole millimetre, the
// same as the die search.

import type { Die } from '@/lib/types';

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
    .filter((d) => {
      const l = mm(d.length), w = mm(d.width);
      return mm(d.cylinder) === cyl && ((l === a && w === b) || (l === b && w === a));
    })
    .sort((x, y) => Number(x.status === 'DAMAGE') - Number(y.status === 'DAMAGE'));
  const options = Array.from(new Set(matched.map((d) => d.ups).filter((u): u is number => u != null && u > 0)));
  return { dies: matched, ups: options.length === 1 ? options[0] : null, options };
}
