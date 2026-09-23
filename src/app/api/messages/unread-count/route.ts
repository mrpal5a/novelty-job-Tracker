// src/app/api/messages/unread-count/route.ts
// ============================================================
// GET /api/messages/unread-count — total unread messages across every
// thread the caller is in. Sums the my_conversations view's per-thread
// unread_count (migration 059) rather than returning the full thread
// list — this is the cheap number the header badge polls, same shape as
// the BOM/dispatch pending-count reads in AdminHeader.
// ============================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';

export async function GET() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('my_conversations')
    .select('unread_count');

  if (error) {
    console.error('[GET /api/messages/unread-count]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const count = (data ?? []).reduce((sum, r) => sum + (r.unread_count ?? 0), 0);
  return NextResponse.json({ count });
}
