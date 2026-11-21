-- ============================================================
-- Deleting a login no longer fails because of what they left behind.
--
-- Team → delete answered "Database error deleting user" for anyone who had
-- sent a chat message (found 2026-11-21): messages.sender_id, and likewise
-- conversations.started_by and print_run_stage_logs.changed_by, pointed at
-- auth.users with NO ACTION, so Postgres refused the delete.
--
-- The history stays; only the link to the gone login is cleared. A message
-- still shows who wrote it (sender_email is kept on the row), a chat keeps
-- its subject and members' messages, a stage log keeps its stage and time.
-- ============================================================

ALTER TABLE messages ALTER COLUMN sender_id DROP NOT NULL;
ALTER TABLE messages
  DROP CONSTRAINT messages_sender_id_fkey,
  ADD CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE conversations ALTER COLUMN started_by DROP NOT NULL;
ALTER TABLE conversations
  DROP CONSTRAINT conversations_started_by_fkey,
  ADD CONSTRAINT conversations_started_by_fkey
    FOREIGN KEY (started_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE print_run_stage_logs
  DROP CONSTRAINT print_run_stage_logs_changed_by_fkey,
  ADD CONSTRAINT print_run_stage_logs_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
