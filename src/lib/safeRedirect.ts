// src/lib/safeRedirect.ts
// Keeps a post-login ?redirectTo= on this site. Parsing against a throwaway
// origin lets the URL parser catch every off-site form (https://x, //x, /\x,
// javascript:, tabs/newlines inside the scheme) — any of them changes the origin.
const BASE = 'http://same-site.invalid';

export function safeRedirect(raw: string | null | undefined, fallback = '/admin'): string {
  if (!raw) return fallback;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return fallback;
    // Dot-segments can normalize to a protocol-relative path: '/x/..//evil.com'
    // → '//evil.com', which the browser treats as another site.
    if (url.pathname.startsWith('//')) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
