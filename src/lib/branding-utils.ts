// src/lib/branding-utils.ts
// Isomorphic (client + server safe) branding types and pure helpers. Split
// out from src/lib/branding.ts, which pulls in the service-role Supabase
// client and must never be imported by client components — this file has
// no such import and can be used anywhere.

export type Branding = {
  name: string;
  shortName: string;
  productionName: string;
  address: string;
  supportEmail: string;
  /** Multi-line factory return address, real newlines. */
  returnAddress: string;
  /** Public URL of an uploaded logo, or null until one is set — callers
   *  fall back to the bundled /company-logo.png default. */
  logoUrl: string | null;
};

export const DEFAULT_BRANDING: Branding = {
  name: 'Your Print Company',
  shortName: 'Your Print Co',
  productionName: 'YOUR PRINT CO',
  address: 'Your City, State, Country',
  supportEmail: 'support@example.com',
  returnAddress: 'YOUR PRINT CO\nYour street address\nYour city - PIN\nYour state\nPHONE - your number',
  logoUrl: null,
};

/** URL-safe slug, used for export filenames etc. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-+|-+$)/g, '') || 'export'
  );
}

/**
 * Splits a production/trade name onto up to two lines, for the roll slip's
 * fixed two-line house-name cell (see RollSlipLabel).
 */
export function productionNameLines(productionName: string): [string, string] {
  const words = productionName.trim().split(/\s+/);
  if (words.length <= 1) return [words[0] ?? '', ''];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}
