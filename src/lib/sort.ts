// src/lib/sort.ts
// Shared comparator for click-to-sort table headers, extracted from the
// pattern JobSeparationManager introduced so every admin table sorts the
// same way. Nulls always sort to the end regardless of direction — "not
// set" reads as "furthest away" either way.

export type SortDir = 'asc' | 'desc';
export type SortKind = 'text' | 'number' | 'date';

export function compareValues(av: unknown, bv: unknown, kind: SortKind): number {
  if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
  if (bv === null || bv === undefined) return -1;

  if (kind === 'number') return (av as number) - (bv as number);
  if (kind === 'date') return new Date(av as string).getTime() - new Date(bv as string).getTime();
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
}
