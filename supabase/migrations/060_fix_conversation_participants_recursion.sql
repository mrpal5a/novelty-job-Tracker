-- ============================================================
-- 060_fix_conversation_participants_recursion.sql
-- Fixes "infinite recursion detected in policy for relation
-- conversation_participants" from 059.
--
-- 059's "Participants can read their thread's roster" policy checked
-- membership with an EXISTS subquery against conversation_participants
-- itself:
--
--   USING (EXISTS (SELECT 1 FROM conversation_participants cp2 WHERE ...))
--
-- Evaluating that policy requires running the subquery, which is itself
-- subject to the same SELECT policy on the same table — so Postgres has
-- to re-evaluate the policy to evaluate the policy, forever. Any query
-- that touches conversation_participants (directly, or indirectly via
-- the conversations/messages policies, or via my_conversations) hit this.
--
-- Fix: move the membership check into a SECURITY DEFINER function, same
-- pattern as dept_is_super_admin() (040) and log_shade_card_status()
-- (056) — it runs as its owner, bypassing RLS internally, so the check
-- inside it never re-triggers the policy that calls it.
-- ============================================================

CREATE OR REPLACE FUNCTION is_conversation_participant(p_conversation_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_participants
    WHERE conversation_id = p_conversation_id AND member_id = auth.uid()
  );
$$;

-- conversations: same policy, rewritten to call the function.
DROP POLICY IF EXISTS "Participants can read their conversations" ON conversations;
CREATE POLICY "Participants can read their conversations"
  ON conversations FOR SELECT
  TO authenticated
  USING (is_conversation_participant(conversations.id));

-- conversation_participants: this is the one that actually recursed.
DROP POLICY IF EXISTS "Participants can read their thread's roster" ON conversation_participants;
CREATE POLICY "Participants can read their thread's roster"
  ON conversation_participants FOR SELECT
  TO authenticated
  USING (is_conversation_participant(conversation_participants.conversation_id));

-- messages: same shape, both the SELECT and the INSERT check.
DROP POLICY IF EXISTS "Participants can read messages in their conversations" ON messages;
CREATE POLICY "Participants can read messages in their conversations"
  ON messages FOR SELECT
  TO authenticated
  USING (is_conversation_participant(messages.conversation_id));

DROP POLICY IF EXISTS "Participants can send messages as themselves" ON messages;
CREATE POLICY "Participants can send messages as themselves"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND is_conversation_participant(messages.conversation_id)
  );

-- conversation_participants' INSERT (dept_is_super_admin()) and UPDATE
-- (member_id = auth.uid()) policies never referenced the table itself and
-- are untouched.
