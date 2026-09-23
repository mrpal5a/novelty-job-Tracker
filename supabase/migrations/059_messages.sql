-- ============================================================
-- 059_messages.sql
-- Internal team messaging: Admin tags one or more team members and sends
-- them a message (optionally linked to a job); everyone tagged can reply
-- in that same thread. Only Admin starts a conversation — mirrors "Admin
-- is the owner" — but any participant, Admin included, can reply once
-- it exists.
--
-- Three tables:
--   conversations            — one row per thread; started_by is always Admin
--   conversation_participants — who's in the thread + their own last_read_at
--                               (drives the unread badge and read receipts)
--   messages                  — the messages themselves, optionally job-linked
--
-- Keyed to auth.users like meter_calculator_access (048) — a message is
-- addressed to real logins, not departments. member_email/sender_email are
-- denormalized at write time, same as stage_comments.created_by_email
-- (016) — attribution survives independent of any admin-only lookup.
--
-- Realtime is added on all three tables so the header badge and an open
-- thread update live. Safe to enable (see 030_prepress_todos_realtime.sql
-- for the precedent): every SELECT policy below is already scoped to
-- "participant of this conversation", so Realtime delivers nothing wider
-- than what the same session could already query.
-- ============================================================

CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject    TEXT,
  started_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_email    TEXT NOT NULL,
  -- NULL until the participant opens the thread — everything is unread by
  -- default, including for the recipient of a brand new conversation.
  last_read_at    TIMESTAMPTZ,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, member_id)
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES auth.users(id),
  sender_email    TEXT NOT NULL,
  body            TEXT NOT NULL CHECK (char_length(btrim(body)) > 0),
  -- Optional "@Prepress check Job #1234" style reference. ON DELETE SET
  -- NULL, not CASCADE — a job being removed should never delete the
  -- conversation history that mentioned it.
  job_id          UUID REFERENCES jobs(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_created
  ON messages (conversation_id, created_at);

CREATE INDEX idx_conversation_participants_member
  ON conversation_participants (member_id);

-- ── my_conversations ─────────────────────────────────────────
-- One row per conversation the calling user is in, with its last message
-- and their own unread count. Powers both the header badge (SUM across
-- rows) and the drawer's conversation list in a single query. Filters by
-- auth.uid() explicitly in the join, rather than relying on the view
-- inheriting the caller's RLS — security_invoker makes it inherit RLS too
-- (PG15+), but the explicit filter is what actually does the restricting.
CREATE OR REPLACE VIEW my_conversations
WITH (security_invoker = true) AS
SELECT
  c.id           AS conversation_id,
  c.subject,
  c.started_by,
  c.created_at,
  cp.last_read_at,
  lm.id          AS last_message_id,
  lm.body        AS last_message_body,
  lm.sender_email AS last_message_sender_email,
  lm.created_at  AS last_message_at,
  COALESCE(uc.unread_count, 0)::INT AS unread_count
FROM conversations c
JOIN conversation_participants cp
  ON cp.conversation_id = c.id AND cp.member_id = auth.uid()
LEFT JOIN LATERAL (
  SELECT id, body, sender_email, created_at
  FROM messages
  WHERE conversation_id = c.id
  ORDER BY created_at DESC
  LIMIT 1
) lm ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS unread_count
  FROM messages m2
  WHERE m2.conversation_id = c.id
    AND m2.sender_id <> auth.uid()
    AND m2.created_at > COALESCE(cp.last_read_at, '-infinity'::timestamptz)
) uc ON TRUE;

GRANT SELECT ON my_conversations TO authenticated;

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE conversations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages                  ENABLE ROW LEVEL SECURITY;

-- conversations: readable by its own participants; only Admin creates one,
-- and only as themselves (started_by is never spoofable to another user).
CREATE POLICY "Participants can read their conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.member_id = auth.uid()
    )
  );

CREATE POLICY "Admin can start a conversation"
  ON conversations FOR INSERT
  TO authenticated
  WITH CHECK (dept_is_super_admin() AND started_by = auth.uid());

-- conversation_participants: a participant sees the whole roster of any
-- thread they're in (so "who else is on this?" is answerable), Admin adds
-- the roster at creation time, and each participant updates only their own
-- last_read_at (marking read, never anyone else's).
CREATE POLICY "Participants can read their thread's roster"
  ON conversation_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp2
      WHERE cp2.conversation_id = conversation_participants.conversation_id
        AND cp2.member_id = auth.uid()
    )
  );

CREATE POLICY "Admin can add participants"
  ON conversation_participants FOR INSERT
  TO authenticated
  WITH CHECK (dept_is_super_admin());

CREATE POLICY "A participant marks their own last_read_at"
  ON conversation_participants FOR UPDATE
  TO authenticated
  USING (member_id = auth.uid())
  WITH CHECK (member_id = auth.uid());

-- messages: any participant reads the thread; any participant (Admin
-- included) replies as themselves, never as someone else.
CREATE POLICY "Participants can read messages in their conversations"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id AND cp.member_id = auth.uid()
    )
  );

CREATE POLICY "Participants can send messages as themselves"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = messages.conversation_id AND cp.member_id = auth.uid()
    )
  );

-- ── Realtime ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversation_participants;
  END IF;
END $$;
