// src/lib/search.test.ts
// The PostgREST filter strings the search boxes send. Size matching is the
// one the floor relies on: a die's length or width is found by its whole
// millimetre, whether the stored value or the search carries decimals.

import { describe, expect, it } from 'vitest';
import { containsPattern, exactFieldRegex, nameMatches, onSearchText, orContains, orMatch, orSizePair, parseSizePair, searchTerms, sizePatterns, startsFirst } from './search';

describe('searchTerms', () => {
  it('squashes case, spaces and punctuation, phrase and words alike', () => {
    expect(searchTerms('UPL - 03')).toEqual({ phrase: 'upl03', words: ['upl', '03'] });
    expect(searchTerms('  PM-203232 ')).toEqual({ phrase: 'pm203232', words: ['pm203232'] });
    expect(searchTerms('riverline riverline 2032')?.words).toEqual(['riverline', '2032']);
  });
  it('nothing searchable left → null (caller falls back)', () => {
    expect(searchTerms('%')).toBeNull();
    expect(searchTerms(' - ')).toBeNull();
  });
});

describe('onSearchText', () => {
  const rec = () => { const calls: string[] = []; const q = { or(f: string) { calls.push(f); return q; } }; return { q, calls }; };
  it('a term matches inside a word, or from a word start skipping spaces', () => {
    const a = rec(); onSearchText(a.q, searchTerms('UPL-03')!, true);
    expect(a.calls).toEqual(['search_text.like."%upl03%",search_text.match."(^|[ |])u ?p ?l ?0 ?3"']);
  });
  it('several words: one ANDed .or() per word, unless run as a phrase', () => {
    const t = searchTerms('riverline 2032')!;
    const a = rec(); onSearchText(a.q, t, true);
    expect(a.calls).toHaveLength(1);
    const b = rec(); onSearchText(b.q, t, false);
    expect(b.calls).toEqual([
      'search_text.like."%riverline%",search_text.match."(^|[ |])r ?i ?v ?e ?r ?l ?i ?n ?e"',
      'search_text.like."%2032%",search_text.match."(^|[ |])2 ?0 ?3 ?2"',
    ]);
  });
  it('the word-start rule keeps "r4" out of "super 456cs" (checked as Postgres reads it)', () => {
    const re = (t: string) => new RegExp(`(^|[ |])${t.split('').join(' ?')}`);
    expect(re('r4').test('|super 456cs 5l label|')).toBe(false);
    expect(re('upl03').test('|x|upl 03|')).toBe(true);
    expect(re('aug261').test('|aug26 10|')).toBe(true);
  });
  it('exact field match is fenced by the | separators', () => {
    expect(exactFieldRegex(searchTerms('20-3232')!)).toBe('\\|2 ?0 ?3 ?2 ?3 ?2\\|');
  });
});

describe('parseSizePair', () => {
  it('reads a size typed as L x W, any separator and spacing', () => {
    expect(parseSizePair('210x60')).toEqual(['210', '60']);
    expect(parseSizePair(' 210 X 60.5 ')).toEqual(['210', '60.5']);
    expect(parseSizePair('210×60')).toEqual(['210', '60']);
    expect(parseSizePair('210*60')).toEqual(['210', '60']);
  });
  it('leaves anything else alone', () => {
    for (const q of ['210', 'PM-203232', 'x60', '210x', 'box 60', '210 60']) expect(parseSizePair(q)).toBeNull();
  });
});

describe('nameMatches', () => {
  it('finds a party by any part of its name, ignoring spaces and dashes', () => {
    for (const q of ['UPL - 53', 'upl 53', 'PL 53', '53', 'upl53', 'pl']) expect(nameMatches('UPL - 53', q)).toBe(true);
    expect(nameMatches('UPL - 53', '85')).toBe(false);
    expect(nameMatches('UPL - 53', 'pl 85')).toBe(false);
  });
});

describe('startsFirst', () => {
  it('lists names starting with the text above ones merely containing it', () => {
    const rows = [{ name: 'SUPLEX' }, { name: 'UPL - 53' }, { name: 'ABC UPL' }];
    expect(startsFirst(rows, 'upl').map((r) => r.name)).toEqual(['UPL - 53', 'SUPLEX', 'ABC UPL']);
  });
});

describe('sizePatterns', () => {
  it('matches the whole millimetre and anything after its decimal point', () => {
    expect(sizePatterns('210')).toEqual(['210', '210.%']);
  });

  it('drops the decimals from what is typed, so 210.84 finds 210 too', () => {
    expect(sizePatterns('210.84')).toEqual(['210', '210.%']);
    expect(sizePatterns('210.')).toEqual(['210', '210.%']);
  });

  it('ignores surrounding spaces and leading zeros', () => {
    expect(sizePatterns(' 082 ')).toEqual(['82', '82.%']);
    expect(sizePatterns('0')).toEqual(['0', '0.%']);
  });

  it('falls back to the whole value for text that is not a number', () => {
    expect(sizePatterns('abc')).toEqual(['abc']);
    expect(sizePatterns('50%')).toEqual(['50\\%']);
  });
});

/** Does a stored value match a LIKE pattern (case-insensitive), as Postgres would? */
function like(value: string, pattern: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    else if (ch === '%') re += '.*';
    else if (ch === '_') re += '.';
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i').test(value);
}
const sizeMatches = (stored: string, typed: string) => sizePatterns(typed).some((p) => like(stored, p));

describe('size matching against stored values', () => {
  it('treats 210 and 210.84 as the same size, either way round', () => {
    expect(sizeMatches('210.84', '210')).toBe(true);
    expect(sizeMatches('210', '210.84')).toBe(true);
    expect(sizeMatches('210', '210')).toBe(true);
    expect(sizeMatches('210.5', '210.84')).toBe(true);
  });

  it('does not match other sizes that merely contain the digits', () => {
    expect(sizeMatches('1210', '210')).toBe(false);
    expect(sizeMatches('2100', '210')).toBe(false);
    expect(sizeMatches('211.84', '210')).toBe(false);
    expect(sizeMatches('21.084', '210')).toBe(false);
  });
});

describe('sizePatterns with a tolerance', () => {
  it('matches every whole millimetre within ±2', () => {
    expect(sizePatterns('210', 2)).toEqual(['208', '208.%', '209', '209.%', '210', '210.%', '211', '211.%', '212', '212.%']);
  });
  it('never goes below zero', () => {
    expect(sizePatterns('1', 2)).toEqual(['0', '0.%', '1', '1.%', '2', '2.%', '3', '3.%']);
  });
  it('ignores the tolerance for text', () => {
    expect(sizePatterns('abc', 2)).toEqual(['abc']);
  });
});

describe('orMatch', () => {
  it('ORs contains-matches and size-matches into one quoted filter', () => {
    expect(orMatch(['shape'], ['length', 'width'], '87')).toBe(
      'shape.ilike."%87%",length.ilike."87",length.ilike."87.%",width.ilike."87",width.ilike."87.%"',
    );
  });

  it('keeps orContains output unchanged for the other searches', () => {
    expect(orContains(['party', 'job_name'], 'ABC, Ltd')).toBe('party.ilike."%ABC, Ltd%",job_name.ilike."%ABC, Ltd%"');
    expect(containsPattern('50%')).toBe('%50\\%%');
  });
});

describe('orSizePair', () => {
  it('matches both sizes, either way round', () => {
    expect(orSizePair(['length', 'width'], '60', '146')).toBe(
      'and(or(length.ilike."60",length.ilike."60.%"),or(width.ilike."146",width.ilike."146.%")),'
      + 'and(or(length.ilike."146",length.ilike."146.%"),or(width.ilike."60",width.ilike."60.%"))',
    );
  });

  it('with one size blank, looks for the other on either side', () => {
    expect(orSizePair(['length', 'width'], '', '87')).toBe(orMatch([], ['length', 'width'], '87'));
  });
});
