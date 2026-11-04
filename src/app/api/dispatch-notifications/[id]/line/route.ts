// src/app/api/dispatch-notifications/[id]/line/route.ts
// PUT    { line_id, confirm? } — tie a dispatch entry to the exact Job
//        Separation line it ships, for one PO + PM code can't place on its
//        own (migration 088). Works on sent entries too: it changes which
//        order the labels count against, never the entry or its date. Answers
//        409 { warnings } (another party, over the order) until sent with confirm.
// DELETE — drop the link, back to matching by PO + PM code.
// Dispatch/Admin only, same gating as the rest of this feature.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { linkWarnings } from '@/lib/dispatchLedger';
import { enteredOnLine } from '@/lib/dispatchChecks';

type Params = { params: Promise<{ id: string }> };

async function authorise() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return { error: NextResponse.json({ error: 'Only Dispatch/Admin can link dispatch entries' }, { status: 403 }) };
  }
  return { who: user.email ?? deptKeyOf(user) ?? 'unknown' };
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const lineId = typeof body.line_id === 'string' ? body.line_id : '';
  if (!lineId) return NextResponse.json({ error: 'Choose the order line' }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: entry, error: entryError }, { data: line, error: lineError }] = await Promise.all([
    admin.from('pending_dispatch_notifications').select('party, qty').eq('id', id).is('removed_at', null).maybeSingle(),
    admin.from('job_separations').select('id, party, po_no, quantity').eq('id', lineId).is('cancelled_at', null).maybeSingle(),
  ]);
  if (entryError || lineError) return NextResponse.json({ error: (entryError ?? lineError)!.message }, { status: 500 });
  if (!entry) return NextResponse.json({ error: 'This entry is removed' }, { status: 404 });
  if (!line)  return NextResponse.json({ error: 'That order line is cancelled or no longer exists' }, { status: 409 });

  if (body.confirm !== true) {
    try {
      const warnings = linkWarnings({ entry, line, entered: await enteredOnLine(admin, line, id) });
      if (warnings.length) return NextResponse.json({ warnings }, { status: 409 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const { error } = await admin
    .from('pending_dispatch_notifications')
    .update({ line_id: lineId, linked_by: auth.who, linked_at: new Date().toISOString() })
    .eq('id', id)
    .is('removed_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const auth = await authorise();
  if (auth.error) return auth.error;

  const { error } = await createAdminClient()
    .from('pending_dispatch_notifications')
    .update({ line_id: null, linked_by: null, linked_at: null })
    .eq('id', id)
    .is('removed_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
