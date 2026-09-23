// src/app/api/messages/conversations/[id]/messages/route.ts
// ============================================================
// POST /api/messages/conversations/[id]/messages — reply in an existing
// thread. Any participant may reply, Admin included, as themselves —
// enforced by the "Participants can send messages as themselves" RLS
// policy (migration 059), not just this check.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) {
    return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
  }
  const jobId = typeof body.jobId === 'string' && body.jobId ? body.jobId : null;

  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: id,
      sender_id:        user.id,
      sender_email:      user.email,
      body:               text,
      job_id:              jobId,
    })
    .select('*, jobs ( id, job_card_number, po_number, party, job_name )')
    .single();

  if (error) {
    // RLS silently returns 0 rows (no error) for a non-participant insert
    // attempt, which .single() turns into PGRST116 — read as "not a
    // participant" rather than surfacing Postgres's own wording.
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: "You're not part of this conversation" }, { status: 403 });
    }
    console.error('[POST /api/messages/conversations/[id]/messages]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    message: {
      id:              message.id,
      conversation_id: message.conversation_id,
      sender_id:       message.sender_id,
      sender_email:    message.sender_email,
      body:            message.body,
      job_id:          message.job_id,
      created_at:      message.created_at,
      job:             message.jobs ?? null,
    },
  }, { status: 201 });
}
