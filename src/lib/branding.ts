// src/lib/branding.ts
// Server-only. Loads company branding from the `company_settings` table —
// a single row, editable by an Admin user from /admin/settings — instead
// of environment variables, so a company can change its own name, address,
// support email, and logo without a redeploy or a call to whoever set this
// up.
//
// NEVER import this from a client component: it pulls in the service-role
// Supabase client. Client components read branding via
// src/components/brand/BrandingProvider.tsx's useBranding() instead, fed
// by the one getBranding() call made in the root layout.
//
// Cached process-wide for CACHE_TTL_MS, same pattern as
// lib/constants/departments.ts — the settings form calls
// invalidateBrandingCache() after every save so edits take effect
// immediately instead of waiting out the TTL.

import { createAdminClient } from '@/lib/supabase/admin';
import { DEFAULT_BRANDING, type Branding } from '@/lib/branding-utils';

export type { Branding } from '@/lib/branding-utils';
export { DEFAULT_BRANDING, slugify, productionNameLines } from '@/lib/branding-utils';

const CACHE_TTL_MS = 60_000;
let cache: { value: Branding; expiresAt: number } | null = null;

export function invalidateBrandingCache(): void {
  cache = null;
}

export async function getBranding(): Promise<Branding> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('company_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !data) {
      cache = { value: DEFAULT_BRANDING, expiresAt: Date.now() + CACHE_TTL_MS };
      return DEFAULT_BRANDING;
    }

    const value: Branding = {
      name: data.company_name || DEFAULT_BRANDING.name,
      shortName: data.company_short_name || DEFAULT_BRANDING.shortName,
      productionName: data.company_production_name || DEFAULT_BRANDING.productionName,
      address: data.address || DEFAULT_BRANDING.address,
      supportEmail: data.support_email || DEFAULT_BRANDING.supportEmail,
      returnAddress: data.return_address || DEFAULT_BRANDING.returnAddress,
      logoUrl: data.logo_url || null,
    };
    cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    // DB unreachable, or the migration hasn't run yet on this project —
    // fail soft to generic defaults rather than 500ing every page.
    return DEFAULT_BRANDING;
  }
}
