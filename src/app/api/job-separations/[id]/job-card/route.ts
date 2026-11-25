// src/app/api/job-separations/[id]/job-card/route.ts
// ============================================================
// GET  /api/job-separations/[id]/job-card — every record a job card for this
//      line can be filled from, and the cards it already has. Read-only; the
//      filling itself is resolveJobCard (src/lib/jobCard.ts). Departments
//      that only look get the line and its issued cards, nothing else.
// POST — start a draft card on this line (one per plate).
// POST needs job_card_edit. Never sends prices or rates.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { jobCardDbError, jobCardWriter, loadIssuedCards, loadJobCardSources } from '@/lib/api/jobCardSources';
import { jobCardFrom } from '@/lib/jobCard';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  try {
    const sources = canDeptEditJobCards(perms)
      ? await loadJobCardSources(createAdminClient(), id)
      : await loadIssuedCards(supabase, id);
    if (!sources) return NextResponse.json({ error: 'Job separation row not found' }, { status: 404 });
    return NextResponse.json({ sources });
  } catch (e) {
    console.error('[GET /api/job-separations/[id]/job-card]', e);
    return NextResponse.json({ error: 'Failed to load job card details' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const writer = await jobCardWriter();
  if ('denied' in writer) return writer.denied;

  const parsed = jobCardFrom(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  delete parsed.columns.manual; // made from its line
  // `part` is set by the database, with the line locked; 0 only satisfies NOT NULL.
  const { data, error } = await createAdminClient().from('job_cards')
    .insert({ ...parsed.columns, job_separation_id: id, part: 0, created_by: writer.name })
    .select().single();
  if (error) return jobCardDbError(error);
  return NextResponse.json({ card: data }, { status: 201 });
}
