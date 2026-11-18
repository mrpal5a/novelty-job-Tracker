// src/lib/dieSearch.test.ts
// The die pages search in the browser; /api/dies searches in SQL. Both are
// built from the same patterns — these pin the browser side's rules.

import { describe, expect, it } from 'vitest';
import { dieRowTest, ROTO_DIE_SEARCH, FLATBED_DIE_SEARCH } from './dieSearch';
import { findParties, likeRegExp } from './search';

const die = (o: Record<string, unknown>) => ({ job_name: null, material: null, corner: null, serial_no: null, location: null, length: null, width: null, cylinder: null, ...o });
const roto = (search: string, extra: Partial<{ field: string; tolerance: number; sizeA: string; sizeB: string }> = {}) =>
  dieRowTest(ROTO_DIE_SEARCH, { search, field: 'all', tolerance: 0, sizeA: '', sizeB: '', ...extra });

describe('likeRegExp reads LIKE patterns as Postgres ILIKE does', () => {
  it('handles %, _, escapes and case', () => {
    expect(likeRegExp('%abc%').test('xxABCyy')).toBe(true);
    expect(likeRegExp('a_c').test('abc')).toBe(true);
    expect(likeRegExp('a_c').test('abbc')).toBe(false);
    expect(likeRegExp('%50\\%%').test('off 50% now')).toBe(true);
    expect(likeRegExp('%50\\%%').test('off 500 now')).toBe(false);
    expect(likeRegExp('%a.b%').test('axb')).toBe(false);
  });
});

describe('dieRowTest', () => {
  const d = die({ job_name: 'HEMANI Sticker', serial_no: 'BNK26-11', location: 'R4', length: '60.5', width: '146', cylinder: 95 });

  it('all fields: text anywhere, sizes on the whole millimetre', () => {
    expect(roto('hemani')(d)).toBe(true);
    expect(roto('bnk26')(d)).toBe(true);
    expect(roto('60')(d)).toBe(true);
    expect(roto('6', { field: 'size' })(d)).toBe(false); // not 60 — whole millimetre
    expect(roto('146.9')(d)).toBe(true);
    expect(roto('nothing')(d)).toBe(false);
  });

  it('one field only looks there', () => {
    expect(roto('hemani', { field: 'location' })(d)).toBe(false);
    expect(roto('r4', { field: 'location' })(d)).toBe(true);
    expect(roto('146', { field: 'size' })(d)).toBe(true);
  });

  it('integer fields match the exact number', () => {
    expect(roto('95', { field: 'cylinder' })(d)).toBe(true);
    expect(roto('9', { field: 'cylinder' })(d)).toBe(false);
    expect(roto('abc', { field: 'cylinder' })(d)).toBe(false);
  });

  it('size boxes match either way round, AND the search, with tolerance', () => {
    expect(roto('', { sizeA: '146', sizeB: '60' })(d)).toBe(true);
    expect(roto('', { sizeA: '146', sizeB: '61' })(d)).toBe(false);
    expect(roto('', { sizeA: '148', sizeB: '61', tolerance: 2 })(d)).toBe(true);
    expect(roto('', { sizeA: '146' })(d)).toBe(true);
    expect(roto('nothing', { sizeA: '146', sizeB: '60' })(d)).toBe(false);
  });

  it('an unknown field falls back to all fields, as the route does', () => {
    expect(roto('hemani', { field: 'toString' })(d)).toBe(true);
  });

  it('flatbed: shape, corner, location and sizes', () => {
    const f = { shape: 'RECTANGLE', corner: 'R2', location: 'Rack 4', length: '60', width: '146', serial_no: 40 };
    const t = (search: string, field = 'all') => dieRowTest(FLATBED_DIE_SEARCH, { search, field, tolerance: 0, sizeA: '', sizeB: '' })(f);
    expect(t('rect')).toBe(true);
    expect(t('40', 'serial_no')).toBe(true);
    expect(t('40')).toBe(false); // serial isn't in "All fields"
  });
});

describe('findParties', () => {
  const parties = [{ name: 'SUPLEX' }, { name: 'UPL - 53' }, { name: 'ARYSTA' }];
  it('ignores spaces and dashes, puts names starting with the text first', () => {
    expect(findParties(parties, 'upl').map((p) => p.name)).toEqual(['UPL - 53', 'SUPLEX']);
    expect(findParties(parties, 'pl 53').map((p) => p.name)).toEqual(['UPL - 53']);
    expect(findParties(parties, '  ')).toEqual([]);
  });
});
