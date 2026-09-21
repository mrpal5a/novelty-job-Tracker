-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 010: prepress_todos + prepress_todo_logs
-- ============================================================
-- Shared reminder checklist for the Prepress team. Anyone in Prepress
-- (or Admin) can add a task; marking it read flags it (the panel shows
-- it green); checking it off deletes the row outright — there is no
-- "done" state beyond that.
--
-- Consolidates original 024 (table) + 026 (marked_read_at) + 030
-- (realtime publication), and 028 (audit log table) + 029 (self-trimming
-- cap at 1000 rows).
-- ============================================================

CREATE TABLE prepress_todos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task            TEXT NOT NULL,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Adds a "mark as read" state between adding a task and deleting it —
  -- nullable timestamp, not a boolean, to match the rest of the schema's
  -- "when did this happen" state markers. NULL means still pending.
  marked_read_at  TIMESTAMPTZ
);

-- Oldest task first — a running list reads top-to-bottom like a queue.
CREATE INDEX idx_prepress_todos_created_at ON prepress_todos (created_at);

ALTER TABLE prepress_todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prepress_todos_select_authenticated"
  ON prepress_todos FOR SELECT
  TO authenticated
  USING (true);

-- Lets the To-Do panel subscribe to postgres_changes as a lightweight
-- "something changed" signal instead of polling. Safe: prepress_todos
-- already has a fully open SELECT policy for `authenticated` above, so
-- Realtime (which delivers changes through RLS) adds no new exposure.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'prepress_todos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE prepress_todos;
  END IF;
END $$;


-- ============================================================
-- TABLE: prepress_todo_logs — audit trail for the checklist: who added,
-- completed/reopened, edited, and deleted each task. A separate table
-- rather than a soft-delete flag, because deleting a task must still
-- leave a permanent record — the row itself is gone, so the task text
-- is snapshotted here at the time of each action.
-- ============================================================
CREATE TABLE prepress_todo_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  todo_id           UUID,
  task              TEXT NOT NULL,
  action            TEXT NOT NULL CHECK (action IN ('created', 'completed', 'reopened', 'edited', 'deleted')),
  actor_department  TEXT,
  actor_email       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newest first — a history reads top-to-bottom like an activity feed.
CREATE INDEX idx_prepress_todo_logs_created_at ON prepress_todo_logs (created_at DESC);

ALTER TABLE prepress_todo_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prepress_todo_logs_select_authenticated"
  ON prepress_todo_logs FOR SELECT
  TO authenticated
  USING (true);

-- Caps the log at its 1000 most-recent rows — wider than the 150 the
-- panel's History view displays, so the team has a CSV-exportable buffer
-- of older rows before they're trimmed for good. Every task produces at
-- least 2-3 log rows over its life, so an active team would otherwise
-- grow this table without bound.
CREATE OR REPLACE FUNCTION trim_prepress_todo_logs()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM prepress_todo_logs
  WHERE id NOT IN (
    SELECT id FROM prepress_todo_logs
    ORDER BY created_at DESC
    LIMIT 1000
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_trim_prepress_todo_logs
  AFTER INSERT ON prepress_todo_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_prepress_todo_logs();
