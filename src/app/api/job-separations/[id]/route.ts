// src/app/api/job-separations/[id]/route.ts
// ============================================================
// PATCH /api/job-separations/[id] — correct a row. Prepress or Admin.
//
// There is no DELETE here — a row is hand-typed off a PO, so mis-entries
// happen, but hard-deleting one leaves a gap in the Sr. No. sequence with
// no explanation. Use POST /api/job-separations/[id]/cancel instead: it
// marks the row cancelled (with a required reason) rather than removing it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { isIsoDate } from '@/lib/jobViews';

type Params = { params: Promise<{ id: string }> };

const TEXT_FIELDS = [
  'sr_no', 'po_no', 'po_date', 'pm_code', 'material_name', 'unit',
  'job_status', 'jc_status', 'aw_send_to',
] as const;

const INT_FIELDS = ['quantity'] as const;

// Returns the response to send back when the caller may not write, null when
// they may. Both verbs on this route gate identically.
async function denyWrite(): Promise<NextResponse | null> {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can change job separation rows' },
      { status: 403 }
    );
  }

  return null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const denied = await denyWrite();
  if (denied) return denied;

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  if ('party' in body) {
    const party = typeof body.party === 'string' ? body.party.trim() : '';
    if (!party) {
      return NextResponse.json({ error: 'Party is required' }, { status: 400 });
    }
    updates.party = party;
  }

  // Required on create (POST), so it can't be blanked here either: the Sr. No.
  // series is filed under the PO's month. And it has to be a real date, or
  // Postgres refuses it with a 500.
  if ('po_date' in body) {
    const d = typeof body.po_date === 'string' ? body.po_date.trim() : '';
    if (!d) return NextResponse.json({ error: 'PO Date is required' }, { status: 400 });
    if (!isIsoDate(d)) return NextResponse.json({ error: 'PO Date is not a valid date' }, { status: 400 });
  }

  for (const field of TEXT_FIELDS) {
    if (field in body) {
      updates[field] = typeof body[field] === 'string' ? body[field].trim() || null : null;
    }
  }

  for (const field of INT_FIELDS) {
    if (field in body) {
      const raw = body[field];
      const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      updates[field] = Number.isFinite(n) ? Math.trunc(n) : null;
    }
  }

  // Rate carries paise — no truncation.
  if ('rate' in body) {
    const raw = body.rate;
    const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    updates.rate = Number.isFinite(n) ? n : null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('job_separations')
    .update(updates)
    .eq('id', id)
    .select()
    .maybeSingle();   // .single() turns "no such row" into an error, and the 404 below into a 500

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Sr. No. ${updates.sr_no} is already on another row` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Job separation row not found' }, { status: 404 });

  return NextResponse.json({ job_separation: data });
}
