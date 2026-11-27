// src/app/api/materials/route.ts
// ============================================================
// GET  /api/materials — Prepress's material list, A→Z (any signed-in user):
//      what every Material field (plates, dies, job cards) picks from.
// POST /api/materials — add a material (Prepress or Admin).
// Separate from /api/bom-materials, BOM's costing list with rates.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase.from('materials').select('id, name').order('name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ materials: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageJobSeparation(perms)) {
    return NextResponse.json({ error: 'Only Prepress or Admin can add materials' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return NextResponse.json({ error: 'Material name is required' }, { status: 400 });
  if (name.length > 200) return NextResponse.json({ error: 'Material name is too long' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.from('materials')
    .insert({ name, created_by: user.email ?? perms?.key ?? null }).select('id, name').single();
  if (error?.code === '23505') {
    return NextResponse.json({ error: `${name} is already on the list` }, { status: 409 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ material: data }, { status: 201 });
}
