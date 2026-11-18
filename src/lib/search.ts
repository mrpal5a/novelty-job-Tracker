// src/lib/search.ts
// Builds PostgREST ilike filters from raw user search text.
//
// Interpolating a search box straight into `.or('col.ilike.%${q}%,...')`
// breaks on ordinary input: a comma or parenthesis ("ABC, Ltd",
// "Labels (Pvt)") is PostgREST filter syntax, so the request fails with a
// parse error instead of returning matches. `%` and `_` also silently act as
// LIKE wildcards. These helpers escape both layers.

/** Escape LIKE's own wildcards so they match literally. */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, '\\$&');
}

/** `%q%` for a single-column `.ilike(column, pattern)` call. */
export function containsPattern(q: string): string {
  return `%${escapeLike(q)}%`;
}

// Constructor, not a literal: \p{…} needs the u flag, which the TS target rejects in a literal.
const NOT_WORD = new RegExp('[^\\p{L}\\p{N}]', 'gu');
const squash = (s: string) => s.toLowerCase().replace(NOT_WORD, '');

/** Every typed word appears somewhere in the name, ignoring case, spaces
 *  and punctuation — "pl 53", "53" and "upl53" all find "UPL - 53". */
export function nameMatches(name: string, q: string): boolean {
  const n = squash(name);
  return q.split(/\s+/).map(squash).every((w) => n.includes(w));
}

/** Names that start with `q` first, then the rest — so "upl" still lists
 *  UPL - 53 above SUPLEX when both match. Stable otherwise. */
export function startsFirst<T extends { name: string }>(rows: T[], q: string): T[] {
  const n = squash(q);
  const starts = (r: T) => (squash(r.name).startsWith(n) ? 0 : 1);
  return [...rows].sort((a, b) => starts(a) - starts(b));
}

/** The party suggestions for what's typed: matches by nameMatches, names
 *  starting with it first, at most `limit`. Nothing typed, nothing shown. */
export function findParties<T extends { name: string }>(parties: T[], q: string, limit = 8): T[] {
  const t = q.trim();
  return t ? startsFirst(parties.filter((p) => nameMatches(p.name, t)), t).slice(0, limit) : [];
}

/**
 * Patterns for a size (a die's length or width) — matched on the whole
 * millimetre, ignoring anything after the decimal point, so 210 and 210.84
 * are the same size whichever one is typed. "210" finds "210", "210.84" and
 * "210.5", but not "1210" or "2100". Text that isn't a number falls back to
 * matching the whole value.
 */
export function sizePatterns(q: string, tolerance = 0): string[] {
  const m = /^0*(\d+)(?:\.\d*)?$/.exec(q.trim());
  if (!m) return [escapeLike(q.trim())];
  // ±tolerance whole millimetres: 210 with 2 is 208 … 212. A die cut 1 mm
  // off the job's size still runs, so "near enough" is a real search.
  const n = Number(m[1]);
  const out: string[] = [];
  for (let v = Math.max(0, n - tolerance); v <= n + tolerance; v++) out.push(String(v), `${v}.%`);
  return out;
}

/** "210x60", "210 × 60", "210*60" → ["210", "60"]: a die or plate size typed
 *  into one box (the Ctrl K palette). Anything else → null. */
export function parseSizePair(q: string): [string, string] | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*$/i.exec(q);
  return m ? [m[1], m[2]] : null;
}

/** Double-quoted for `.or(...)`, so commas and parentheses inside it are
 *  data, not syntax; PostgREST unescapes `\"` and `\\` inside quotes. */
function quote(pattern: string): string {
  return `"${pattern.replace(/["\\]/g, '\\$&')}"`;
}

/** `col1.ilike."%q%",col2.ilike."%q%"` for `.or(...)`. */
export function orContains(columns: readonly string[], q: string): string {
  return orMatch(columns, [], q);
}

/** Two sizes typed together (L × W), each on the whole millimetre and
 *  either way round — the sheets don't agree on which side is which — so
 *  60 × 146 finds 60 × 146 and 146 × 60. With one size blank, the other is
 *  looked for on either column. For `.or(...)`; ANDs with the main search. */
export function orSizePair([c1, c2]: readonly [string, string], a: string, b: string, tolerance = 0): string {
  if (!a || !b) return orMatch([], [c1, c2], a || b, tolerance);
  const on = (col: string, q: string) => `or(${orMatch([], [col], q, tolerance)})`;
  return `and(${on(c1, a)},${on(c2, b)}),and(${on(c1, b)},${on(c2, a)})`;
}

/** Contains-match on `contains` columns and size-match (see sizePatterns)
 *  on `sizes` ones, OR'd together for one `.or(...)`. */
export function orMatch(contains: readonly string[], sizes: readonly string[], q: string, tolerance = 0): string {
  const c = quote(containsPattern(q));
  const s = sizePatterns(q, tolerance).map(quote);
  return [
    ...contains.map((col) => `${col}.ilike.${c}`),
    ...sizes.flatMap((col) => s.map((p) => `${col}.ilike.${p}`)),
  ].join(',');
}

// ── The same matching, for lists already in the browser ─────────────
// The die pages hold every die, so they filter in memory instead of asking
// the server on each keystroke. These test a row against the very patterns
// the .or(...) filters above send, read the way Postgres ILIKE reads them,
// so a search finds the same rows either way.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A LIKE pattern as a case-insensitive RegExp: % is any run, _ one character, \ escapes. */
export function likeRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) re += escapeRe(pattern[++i]);
    else if (ch === '%') re += '[\\s\\S]*';
    else if (ch === '_') re += '[\\s\\S]';
    else re += escapeRe(ch);
  }
  return new RegExp(`^${re}$`, 'i');
}

export type RowTest = (row: object) => boolean;

function columnMatches(row: object, column: string, patterns: RegExp[]): boolean {
  const v = (row as Record<string, unknown>)[column];
  return v != null && patterns.some((p) => p.test(String(v)));
}

/** In-memory twin of orMatch(contains, sizes, q, tolerance). */
export function matchRow(contains: readonly string[], sizes: readonly string[], q: string, tolerance = 0): RowTest {
  const c = [likeRegExp(containsPattern(q))];
  const s = sizePatterns(q, tolerance).map(likeRegExp);
  return (row) => contains.some((col) => columnMatches(row, col, c)) || sizes.some((col) => columnMatches(row, col, s));
}

/** In-memory twin of orSizePair. */
export function matchSizePair([c1, c2]: readonly [string, string], a: string, b: string, tolerance = 0): RowTest {
  if (!a || !b) return matchRow([], [c1, c2], a || b, tolerance);
  const on = (col: string, q: string) => matchRow([], [col], q, tolerance);
  const [a1, b2, b1, a2] = [on(c1, a), on(c2, b), on(c1, b), on(c2, a)];
  return (row) => (a1(row) && b2(row)) || (b1(row) && a2(row));
}

// ── search_text: one forgiving search over a row's key fields ───────
// A table with a search_text column (migration 098 onwards) holds each key
// field lowercased with only letters and digits kept, the fields joined by
// "|": "|aug261|upl03|5000485|203232|marinepollutant10x10cm|". Typed text is
// squashed the same way, so "upl 03", "UPL-03" and "upl03" are one search.

/** Lowercase, letters and digits only — exactly what search_text holds. */
export function squashAscii(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type SearchTerms = {
  /** The whole text squashed: "UPL - 03" → "upl03". */
  phrase: string;
  /** Each typed word squashed: "riverline 2032" → ["riverline", "2032"]. */
  words: string[];
};

/** null when nothing searchable is left (only punctuation): the caller
 *  then falls back to the plain contains-search. */
export function searchTerms(q: string): SearchTerms | null {
  const phrase = squashAscii(q);
  if (!phrase) return null;
  const words = Array.from(new Set(q.split(/\s+/).map(squashAscii).filter(Boolean)));
  return { phrase, words };
}

type Ilikeable<Q> = { ilike: (column: string, pattern: string) => Q };

/**
 * Filters on search_text. As a phrase, the whole text must sit inside one
 * field ("|" can't be typed, so a match never spans two): "UPL - 03" finds
 * party UPL - 03, not UPL - 13 with an 03 in its PO. As words, every word
 * must be somewhere in the row: "riverline 2032" finds that party's PM code.
 * Squashed text is only letters and digits, so it needs no LIKE escaping.
 */
export function onSearchText<Q extends Ilikeable<Q>>(q: Q, t: SearchTerms, asPhrase: boolean): Q {
  if (asPhrase || t.words.length < 2) return q.ilike('search_text', `%${t.phrase}%`);
  return t.words.reduce((acc, w) => acc.ilike('search_text', `%${w}%`), q);
}

/** search_text pattern for a field equal to the whole text — the "exact
 *  match" listed first: "203232" is that PM code, not 2032321. */
export function exactFieldPattern(t: SearchTerms): string {
  return `%|${t.phrase}|%`;
}
