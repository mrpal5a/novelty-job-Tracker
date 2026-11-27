// src/app/api/bom-materials/names/route.ts
// GET /api/bom-materials/names — the active BOM material names, A→Z, for any
// signed-in user. Plates, dies and job cards pick their Material from this list
// so a material is spelt one way across the app. Names only: rates stay behind
// /api/bom-materials (bom_use + canDeptSeeMaterialRates).

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';

export async function GET() {
  const user = await getClaimsUser(await createServerSupabaseClient());
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Service role: bom_materials RLS is bom_use only; this returns names, never rates.
  const { data, error } = await createAdminClient()
    .from('bom_materials').select('name').eq('is_active', true).order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ names: (data ?? []).map((m) => m.name as string) });
}
