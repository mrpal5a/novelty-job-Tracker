// src/app/api/messages/conversations/[id]/read/route.ts
// ============================================================
// POST /api/messages/conversations/[id]/read — mark the calling user's
// own copy of this thread read. Bumps conversation_participants.last_read_at
// to now(); the "A participant marks their own last_read_at" RLS policy
// (migration 059) means this can only ever touch the caller's own row.
// ============================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', id)
    .eq('member_id', user.id);

  if (error) {
    console.error('[POST /api/messages/conversations/[id]/read]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
