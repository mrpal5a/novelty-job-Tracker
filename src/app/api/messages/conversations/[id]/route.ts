// src/app/api/messages/conversations/[id]/route.ts
// ============================================================
// GET /api/messages/conversations/[id] — one thread: its roster + every
// message, oldest first, each with its linked job resolved (if any).
// RLS on `conversations`/`messages` already restricts this to a
// participant of the thread — a non-participant gets a clean 404 rather
// than a 403, so a thread's existence isn't itself leaked.
// ============================================================

import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import type { ConversationDetail, MessageWithJob } from '@/lib/types';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: conversation, error: convError } = await supabase
    .from('conversations')
    .select('id, subject, started_by, created_at')
    .eq('id', id)
    .maybeSingle();

  if (convError) {
    console.error('[GET /api/messages/conversations/[id]] conversation', convError);
    return NextResponse.json({ error: convError.message }, { status: 500 });
  }
  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const { data: participants, error: partError } = await supabase
    .from('conversation_participants')
    .select('member_id, member_email, last_read_at')
    .eq('conversation_id', id);

  if (partError) {
    console.error('[GET /api/messages/conversations/[id]] participants', partError);
    return NextResponse.json({ error: partError.message }, { status: 500 });
  }

  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('*, jobs ( id, job_card_number, po_number, party, job_name )')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  if (msgError) {
    console.error('[GET /api/messages/conversations/[id]] messages', msgError);
    return NextResponse.json({ error: msgError.message }, { status: 500 });
  }

  const detail: ConversationDetail = {
    id:           conversation.id,
    subject:      conversation.subject,
    started_by:   conversation.started_by,
    created_at:   conversation.created_at,
    participants: participants ?? [],
    messages: (messages ?? []).map((m): MessageWithJob => ({
      id:              m.id,
      conversation_id: m.conversation_id,
      sender_id:       m.sender_id,
      sender_email:    m.sender_email,
      body:            m.body,
      job_id:          m.job_id,
      created_at:      m.created_at,
      job:             m.jobs ?? null,
    })),
  };

  return NextResponse.json({ conversation: detail });
}
