-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 016: note_reads
-- ============================================================
-- Per-message read state for the global Notes feed (stage_comments, see
-- 004_jobs_core.sql). A real per-note, per-user read receipt, so the
-- team can mark individual notes as read and see an accurate
-- remaining-unread count that follows them across devices, rather than
-- a single "last seen" timestamp kept in browser localStorage that can
-- only mark everything seen at once.
--
-- Consolidates original migration 017, unchanged since.
-- ============================================================

CREATE TABLE note_reads (
  note_id    UUID NOT NULL REFERENCES stage_comments(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, user_email)
);

ALTER TABLE note_reads ENABLE ROW LEVEL SECURITY;

-- A user may only see and record their own read state — never another
-- account's. Writes go through the admin client in the API route (same
-- convention as stage_comments inserts), but the policy still documents
-- and enforces the intended shape in case that ever changes.
CREATE POLICY "Users can read their own note-read state"
  ON note_reads FOR SELECT
  TO authenticated
  USING (user_email = (auth.jwt() ->> 'email'));

CREATE POLICY "Users can mark notes read for themselves"
  ON note_reads FOR INSERT
  TO authenticated
  WITH CHECK (user_email = (auth.jwt() ->> 'email'));
