// src/lib/notifications/logoDataUri.ts
// Base64-inlines the company logo for transactional emails — embedding it
// directly avoids depending on a URL resolving to a publicly reachable host
// (which broke image loading for recipients: a misconfigured/unreachable
// URL, or a host behind deployment protection, both fail silently as a
// broken image icon in the recipient's inbox).
//
// The logo can now change at any time (uploaded from /admin/settings), so
// this fetches it fresh per send rather than inlining it once at import
// time. Falls back to the bundled public/company-logo.png when no logo has
// been uploaded yet.

import fs from 'node:fs';
import path from 'node:path';

export const LOGO_CID = 'company-logo';

async function readFallbackLogo(): Promise<{ dataUri: string }> {
  const logoPath = path.join(process.cwd(), 'public', 'company-logo.png');
  const buf = fs.readFileSync(logoPath);
  return { dataUri: `data:image/png;base64,${buf.toString('base64')}` };
}

export async function getLogoDataUri(logoUrl: string | null): Promise<string> {
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        const contentType = res.headers.get('content-type') || 'image/png';
        const buf = Buffer.from(await res.arrayBuffer());
        return `data:${contentType};base64,${buf.toString('base64')}`;
      }
    } catch {
      // Fall through to the bundled default below.
    }
  }
  return (await readFallbackLogo()).dataUri;
}
