// src/app/api/materials/[id]/route.ts
// DELETE /api/materials/[id] — remove a material from Prepress's list
// (Prepress or Admin). Plates, dies and job cards store the name as text, so
// a record saved with it keeps it; only the dropdown stops offering it.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getClaimsUser(await createServerSupabaseClient());
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageJobSeparation(perms)) {
    return NextResponse.json({ error: 'Only Prepress or Admin can remove materials' }, { status: 403 });
  }

  const { data, error } = await createAdminClient().from('materials').delete().eq('id', id).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Material not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
