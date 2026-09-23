-- ============================================================
-- 061_perf_rls_initplan_fk_indexes.sql
-- Performance pass flagged by the Supabase performance advisor.
--
-- 1. auth_rls_initplan: five policies called auth.uid() / auth.jwt()
--    bare, which Postgres re-evaluates for every row scanned. Wrapping
--    the call in (SELECT ...) turns it into an InitPlan evaluated once
--    per statement. Same predicate, same roles — behaviour unchanged.
--
-- 2. unindexed_foreign_keys: covering indexes for the FKs that sit on
--    real query paths (message threads, machine queue, job-separation
--    links, BOM material lookups, run-stage audit, shade card audit) so
--    joins and ON DELETE checks stop scanning the child table.
--
-- 3. note_reads(user_email): the notes feed filters by the caller's
--    email on every poll; the PK leads with note_id so it can't serve
--    that lookup on its own.
--
-- 4. stage_comments joins the supabase_realtime publication so the
--    NotesFeed can react to new notes instead of polling every 25s.
--    Its SELECT policy is already "any authenticated user", so Realtime
--    delivers nothing a session couldn't already read.
-- ============================================================

-- ── 1. RLS InitPlan rewrites ────────────────────────────────

ALTER POLICY "Participants can send messages as themselves" ON messages
  WITH CHECK ((sender_id = (SELECT auth.uid())) AND is_conversation_participant(conversation_id));

ALTER POLICY "Admin can start a conversation" ON conversations
  WITH CHECK (dept_is_super_admin() AND (started_by = (SELECT auth.uid())));

ALTER POLICY "A participant marks their own last_read_at" ON conversation_participants
  USING      (member_id = (SELECT auth.uid()))
  WITH CHECK (member_id = (SELECT auth.uid()));

ALTER POLICY "Users can read their own note-read state" ON note_reads
  USING (user_email = ((SELECT auth.jwt()) ->> 'email'));

ALTER POLICY "Users can mark notes read for themselves" ON note_reads
  WITH CHECK (user_email = ((SELECT auth.jwt()) ->> 'email'));

-- ── 2. Foreign-key covering indexes ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_messages_sender_id             ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_job_id                ON messages (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_started_by       ON conversations (started_by);
CREATE INDEX IF NOT EXISTS idx_mqi_job_id                     ON machine_queue_items (job_id);
CREATE INDEX IF NOT EXISTS idx_job_separations_linked_job_id  ON job_separations (linked_job_id) WHERE linked_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bom_material_requests_material ON bom_material_requests (material_id);
CREATE INDEX IF NOT EXISTS idx_prsl_changed_by                ON print_run_stage_logs (changed_by);
CREATE INDEX IF NOT EXISTS idx_sc_history_changed_by          ON shade_card_status_history (changed_by);
CREATE INDEX IF NOT EXISTS idx_shade_cards_created_by         ON shade_cards (created_by);
CREATE INDEX IF NOT EXISTS idx_shade_cards_updated_by         ON shade_cards (updated_by);

-- ── 3. Notes feed read-state lookup ─────────────────────────

CREATE INDEX IF NOT EXISTS idx_note_reads_user_email ON note_reads (user_email, note_id);

-- ── 4. Realtime for internal notes ──────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'stage_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE stage_comments;
  END IF;
END $$;
