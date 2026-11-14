// /track lookup rules, kept out of the page so they can be tested.

// Lowercase, letters and digits only. Mirrors the jobs.po_norm / pm_norm
// generated columns (migration 069), so a client typing "abc 123 25" finds
// PO "ABC-123/25". Plain equality — no pattern, so a short or
// wildcard-looking term can never widen the search.
export function normalizeRef(term: string): string {
  return term.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

// Does what the client typed as Company Name identify this job's party?
// Ignoring case, spaces and punctuation, either:
//  - it's the start of our party name and covers at least its whole first
//    word ("Dhanuka" for DHANUKA - SANAND), or
//  - it starts with our whole party name — clients type their full legal
//    name ("Arysta LifeScience India Ltd") where we store "ARYSTA".
// This used to be a 2-letter "contains" match, so anyone holding a PO
// number could get in with "ar" or "in".
export function companyMatches(party: string | null | undefined, typed: string): boolean {
  const name = normalizeRef(party ?? '');
  const input = normalizeRef(typed);
  if (name.length < 2 || input.length < 2) return false;
  const firstWord = normalizeRef((party ?? '').split(/[^A-Za-z0-9]+/).find(Boolean) ?? '');
  return (input.length >= firstWord.length && name.startsWith(input)) || input.startsWith(name);
}
