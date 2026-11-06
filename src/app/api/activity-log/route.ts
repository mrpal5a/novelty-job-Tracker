// src/app/api/activity-log/route.ts
// ============================================================
// GET /api/activity-log — newest data changes first, for the Activity Log page.
//   ?section=  a key from ACTIVITY_SECTIONS
//   ?actor=    a login's id, or "system" for changes with no signed-in person
//   ?from= &to=  YYYY-MM-DD, whole days in IST
//   ?q=        text in the record's name (job card, PO, serial no…)
//   ?before=   id of the last entry already shown, for the next page
// Admin only. Read-only: the database trigger in migration 089 writes the log.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { containsPattern } from '@/lib/search';
import { ACTIVITY_PAGE_SIZE, tablesInSection } from '@/lib/activityLog';

const DAY  = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) {
    return NextResponse.json({ error: 'Only Admin can view the activity log' }, { status: 403 });
  }

  const params = request.nextUrl.searchParams;

  // One more than a page: if it comes back, there is an older page.
  let query = createAdminClient()
    .from('activity_log')
    .select('id, changed_at, actor_id, actor_name, actor_dept, table_name, action, label, changes')
    .order('id', { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE + 1);

  const section = params.get('section');
  if (section) {
    const tables = tablesInSection(section);
    if (!tables) return NextResponse.json({ error: 'Unknown section' }, { status: 400 });
    query = query.in('table_name', tables);
  }

  const actor = params.get('actor');
  if (actor === 'system') query = query.is('actor_id', null);
  else if (actor) {
    if (!UUID.test(actor)) return NextResponse.json({ error: 'Unknown person' }, { status: 400 });
    query = query.eq('actor_id', actor);
  }

  const from = params.get('from');
  const to   = params.get('to');
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 });
  }
  if (from) query = query.gte('changed_at', `${from}T00:00:00+05:30`);
  if (to)   query = query.lte('changed_at', `${to}T23:59:59.999+05:30`);

  const q = params.get('q')?.trim();
  if (q) query = query.ilike('label', containsPattern(q));

  const before = Number(params.get('before'));
  if (Number.isSafeInteger(before) && before > 0) query = query.lt('id', before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  return NextResponse.json({
    entries: rows.slice(0, ACTIVITY_PAGE_SIZE),
    hasMore: rows.length > ACTIVITY_PAGE_SIZE,
  });
}
