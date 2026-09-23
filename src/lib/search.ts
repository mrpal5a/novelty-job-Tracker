// src/lib/search.ts
// Builds PostgREST ilike filters from raw user search text.
//
// Interpolating a search box straight into `.or('col.ilike.%${q}%,...')`
// breaks on ordinary input: a comma or parenthesis ("ABC, Ltd",
// "Labels (Pvt)") is PostgREST filter syntax, so the request fails with a
// parse error instead of returning matches. `%` and `_` also silently act as
// LIKE wildcards. These helpers escape both layers.

/** Escape LIKE's own wildcards so they match literally. */
function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, '\\$&');
}

/** `%q%` for a single-column `.ilike(column, pattern)` call. */
export function containsPattern(q: string): string {
  return `%${escapeLike(q)}%`;
}

/**
 * `col1.ilike."%q%",col2.ilike."%q%"` for `.or(...)`. The value is
 * double-quoted so commas and parentheses inside it are data, not syntax;
 * PostgREST unescapes `\"` and `\\` inside quotes.
 */
export function orContains(columns: readonly string[], q: string): string {
  const quoted = `"${containsPattern(q).replace(/["\\]/g, '\\$&')}"`;
  return columns.map((c) => `${c}.ilike.${quoted}`).join(',');
}
