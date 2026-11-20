// src/lib/dieSearch.ts
// What the roto and flatbed die searches look at — one definition for the
// API routes (which turn it into SQL) and the die pages (which hold every
// die and filter in the browser, so results follow each key with no wait).

import { matchRow, matchSizePair, type RowTest } from './search';

// Integer columns match the exact number: Postgres has no ILIKE for them
// (see /api/dies). 'number' is the same for decimals (the height gap).
export type DieSearchField = { column: string; type: 'text' | 'size' | 'int' | 'number' };
export type DieSearch = {
  /** ?field= value → what it searches. Anything else means "All fields". */
  fields:  Record<string, DieSearchField>;
  /** Text columns "All fields" looks in, besides the sizes. */
  allText: readonly string[];
};

/** Length and width: matched on the whole millimetre (sizePatterns). */
export const DIE_SIZE_COLUMNS = ['length', 'width'] as const;

export const ROTO_DIE_SEARCH: DieSearch = {
  fields: {
    job_name:  { column: 'job_name',  type: 'text' },
    serial_no: { column: 'serial_no', type: 'text' },
    material:  { column: 'material',  type: 'text' },
    corner:    { column: 'corner',    type: 'text' },
    location:  { column: 'location',  type: 'text' },
    // One "Size" option: a number can be read off either side of the die.
    size:      { column: 'size',      type: 'size' },
    shape:     { column: 'shape',     type: 'text' },
    height_gap: { column: 'across_gap', type: 'number' },
    cylinder:  { column: 'cylinder',  type: 'int' },
    ups:       { column: 'ups',       type: 'int' },
  },
  // Someone holding a die searches by whatever they can read off it.
  allText: ['job_name', 'material', 'corner', 'shape', 'serial_no', 'location'],
};

export const FLATBED_DIE_SEARCH: DieSearch = {
  fields: {
    serial_no:     { column: 'serial_no',     type: 'int' },
    shape:         { column: 'shape',         type: 'text' },
    corner:        { column: 'corner',        type: 'text' },
    location:      { column: 'location',      type: 'text' },
    size:          { column: 'size',          type: 'size' },
    repeat_length: { column: 'repeat_length', type: 'text' },
    gap:           { column: 'gap',           type: 'text' },
    ups:           { column: 'ups',           type: 'int' },
  },
  allText: ['shape', 'corner', 'location'],
};

/** A die page's search as a row test — the rules the routes apply in SQL:
 *  the search box (one field or all), ANDed with the two size boxes. */
export function dieRowTest(
  config: DieSearch,
  { search, field, tolerance, sizeA, sizeB }: { search: string; field: string; tolerance: number; sizeA: string; sizeB: string },
): RowTest {
  const tests: RowTest[] = [];
  const q = search.trim();
  if (q) {
    const f = Object.prototype.hasOwnProperty.call(config.fields, field) ? config.fields[field] : undefined;
    if (f?.type === 'int' || f?.type === 'number') {
      const n = f.type === 'int' ? Math.trunc(Number(q)) : Number(q);
      tests.push((row) => {
        const v = (row as Record<string, unknown>)[f.column];
        return Number.isFinite(n) && v != null && Number(v) === n;
      });
    } else if (f?.type === 'size') tests.push(matchRow([], DIE_SIZE_COLUMNS, q, tolerance));
    else if (f) tests.push(matchRow([f.column], [], q));
    else tests.push(matchRow(config.allText, DIE_SIZE_COLUMNS, q, tolerance));
  }
  const a = sizeA.trim(), b = sizeB.trim();
  if (a || b) tests.push(matchSizePair(DIE_SIZE_COLUMNS, a, b, tolerance));
  return (row) => tests.every((t) => t(row));
}
