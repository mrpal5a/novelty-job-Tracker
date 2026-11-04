// src/app/api/dispatch-notifications/route.ts
// GET /api/dispatch-notifications — pending dispatch events grouped by
// party, for the "Dispatch Emails" panel. Dispatch/Admin only.
// GET ?view=history — every entry that has left the queue, been team-emailed
// or been removed, newest first, with the order line it matched.
// GET ?view=lines — every live order line with its running total, for the
// "Link to line" dialog.
// POST /api/dispatch-notifications — add a manual, free-text entry (no
// backing job) for a dispatch that happened outside the normal flow.
// Answers 409 { warnings, choices } (lib/dispatchChecks.ts) until sent again
// with confirm: true; line_id ties it to one of the choices.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDispatchNotifications } from '@/lib/constants/departments';
import type { PendingDispatchNotification, PendingDispatchGroup, DispatchHistoryRow, DispatchLineOption } from '@/lib/types';
import { deptKeyOf } from '@/lib/identity';
import { allPages } from '@/lib/api/allPages';
import { lineMatcher } from '@/lib/dispatchLedger';
import { dispatchCheck } from '@/lib/dispatchChecks';

const MANUAL_STATUSES = ['Partial Dispatch', 'Dispatched'] as const;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can view dispatch notifications' }, { status: 403 });
  }

  const admin = createAdminClient();

  // ?count=pending — just the number of parties with a batch waiting, for
  // the header badge. Reads only the party column (served by the partial
  // idx_pending_dispatch_notifications_pending index) instead of shipping
  // every pending row to the client to count groups there.
  if (request.nextUrl.searchParams.get('count') === 'pending') {
    const { data, error } = await admin
      .from('pending_dispatch_notifications')
      .select('party')
      .is('notified_at', null)
      .is('removed_at', null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const parties = new Set((data ?? []).map((r: { party: string }) => r.party));
    return NextResponse.json({ pending: parties.size });
  }

  const view = request.nextUrl.searchParams.get('view');
  if (view === 'history' || view === 'lines') {
    try {
      const { entries, lines, lineOf, entered } = await ledger();
      if (view === 'lines') {
        const options: DispatchLineOption[] = lines
          .sort((a, b) => (b.po_date ?? '').localeCompare(a.po_date ?? ''))
          .map(({ po_date: _date, ...l }) => ({ ...l, entered: entered.get(l.id) ?? 0 }));
        return NextResponse.json({ lines: options });
      }
      const rows: DispatchHistoryRow[] = entries
        .filter((e) => e.notified_at || e.confirmed_at || e.removed_at)
        .map((e) => {
          const l = lineOf(e);
          return { ...e, line: l ? { id: l.id, sr_no: l.sr_no, quantity: l.quantity, entered: entered.get(l.id) ?? 0 } : null };
        });
      return NextResponse.json({ rows });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const { data, error } = await admin
    .from('pending_dispatch_notifications')
    .select('*')
    .is('notified_at', null)
    .is('removed_at', null)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as PendingDispatchNotification[];
  const groups = new Map<string, PendingDispatchNotification[]>();
  for (const row of rows) {
    const list = groups.get(row.party) ?? [];
    list.push(row);
    groups.set(row.party, list);
  }

  const result: PendingDispatchGroup[] = Array.from(groups.entries())
    .map(([party, items]) => ({ party, items }))
    .sort((a, b) => a.party.localeCompare(b.party));

  // How many contacts each party has on file — the queue marks a party with
  // none as not ready, since its email would have nowhere to go.
  if (result.length > 0) {
    const { data: contacts } = await admin
      .from('party_contacts')
      .select('party, email')
      .in('party', result.map((g) => g.party));
    const counts = new Map<string, number>();
    for (const c of (contacts ?? []) as { party: string; email: string | null }[]) {
      if (c.email) counts.set(c.party, (counts.get(c.party) ?? 0) + 1);
    }
    for (const g of result) g.contact_count = counts.get(g.party) ?? 0;
  }

  return NextResponse.json({ groups: result });
}

// ponytail: reads the whole entry table and order book per request (a few
// thousand rows a year); page by date range if that grows past ~10k.
async function ledger() {
  const admin = createAdminClient();
  const [entries, lines] = await Promise.all([
    allPages<PendingDispatchNotification>((from, to) => admin.from('pending_dispatch_notifications').select('*')
      .order('created_at', { ascending: false }).order('id').range(from, to)),
    allPages<Omit<DispatchLineOption, 'entered'> & { po_date: string | null }>((from, to) => admin.from('job_separations')
      .select('id, sr_no, party, po_no, po_date, pm_code, material_name, quantity')
      .is('cancelled_at', null).order('id').range(from, to)),
  ]);

  const match = lineMatcher(lines);
  const lineOf = (e: PendingDispatchNotification) => match(e.po_number, e.pm_code, e.line_id);

  // Every live entry, sent or still queued, adds to its line's total.
  const entered = new Map<string, number>();
  for (const e of entries) {
    const l = !e.removed_at && lineOf(e);
    if (l) entered.set(l.id, (entered.get(l.id) ?? 0) + (e.qty ?? 0));
  }
  return { entries, lines, lineOf, entered };
}

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageDispatchNotifications(perms)) {
    return NextResponse.json({ error: 'Only Dispatch/Admin can add dispatch entries' }, { status: 403 });
  }

  const body = await request.json();
  const party     = typeof body.party === 'string' ? body.party.trim() : '';
  const poNumber  = typeof body.po_number === 'string' ? body.po_number.trim() : '';
  const jobName   = typeof body.job_name === 'string' ? body.job_name.trim() : '';
  const remark    = typeof body.remark === 'string' ? body.remark.trim() : '';
  const pmCode    = typeof body.pm_code === 'string' ? body.pm_code.trim() : '';
  const status    = body.status;
  const qty       = Number.isFinite(body.qty) ? Number(body.qty) : null;

  if (!party)                                        return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  if (!poNumber)                                      return NextResponse.json({ error: 'PO number is required' }, { status: 400 });
  if (!MANUAL_STATUSES.includes(status))              return NextResponse.json({ error: 'Status must be Partial Dispatch or Dispatched' }, { status: 400 });

  const lineId = typeof body.line_id === 'string' && body.line_id ? body.line_id : null;

  const admin = createAdminClient();
  if (lineId || body.confirm !== true) {
    try {
      const { warnings, choices, line } = await dispatchCheck(admin, { po: poNumber, pm: pmCode || null, qty, lineId });
      if (lineId && !line) return NextResponse.json({ error: 'That order line is cancelled or no longer exists' }, { status: 409 });
      if (body.confirm !== true && warnings.length) return NextResponse.json({ warnings, choices }, { status: 409 });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  const { error } = await admin
    .from('pending_dispatch_notifications')
    .insert({
      job_id:    null,
      job_name:  jobName || null,
      po_number: poNumber,
      party,
      status,
      qty,
      remark:    remark || null,
      pm_code:   pmCode || null,
      created_by: user.email ?? deptKeyOf(user) ?? null,
      ...(lineId && { line_id: lineId, linked_by: user.email ?? deptKeyOf(user) ?? null, linked_at: new Date().toISOString() }),
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: true });
}
