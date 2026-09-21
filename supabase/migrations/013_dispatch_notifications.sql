-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 013: internal_notification_recipients + pending_dispatch_notifications
-- ============================================================
-- internal_notification_recipients: staff/team email addresses that get
-- a copy of the dispatch notification whenever a job goes to Partial
-- Dispatch or Dispatched. Managed from /admin/notifications, Admin only.
-- Consolidates original 037 (table) + 040 (RLS onto
-- dept_has_permission('notification_recipients_manage')).
--
-- pending_dispatch_notifications: jobs are marked Dispatched/Partial
-- Dispatch one-by-one, but a single truck run often carries several
-- orders for the same party. Each dispatch event queues a row here;
-- Dispatch/Admin then sends one consolidated email per party whenever a
-- batch is complete. Consolidates original 038 (table) + 040 (SELECT/
-- UPDATE onto dept_has_permission('dispatch_notifications')) + 042
-- (job_id made nullable + INSERT policy for manual entries) + 043
-- (DELETE policy) + 044 (internal/party sends split + 100-row history
-- cap) + 045 (pm_code column).
--
-- NOTE ON AN INTENTIONAL INCONSISTENCY: SELECT/UPDATE below use
-- dept_has_permission('dispatch_notifications') (rewritten by 040), but
-- INSERT/DELETE use current_dept() IN ('Dispatch', 'Admin') directly —
-- those two policies were added by 042/043, both AFTER 040, and were
-- never migrated onto the permission-table system. This is the actual
-- live behavior today; kept exactly as-is rather than "fixed" here,
-- since consolidating migrations must not change behavior.
-- ============================================================

CREATE TABLE internal_notification_recipients (
  id         UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT    NOT NULL UNIQUE,
  label      TEXT,                     -- optional, e.g. "Accounts" or a person's name
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE internal_notification_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read internal notification recipients"
  ON internal_notification_recipients FOR SELECT
  TO authenticated
  USING (dept_has_permission('notification_recipients_manage'));

CREATE POLICY "Admin can insert internal notification recipients"
  ON internal_notification_recipients FOR INSERT
  TO authenticated
  WITH CHECK (dept_has_permission('notification_recipients_manage'));

CREATE POLICY "Admin can delete internal notification recipients"
  ON internal_notification_recipients FOR DELETE
  TO authenticated
  USING (dept_has_permission('notification_recipients_manage'));


-- ============================================================
-- TABLE: pending_dispatch_notifications
-- ============================================================
CREATE TABLE pending_dispatch_notifications (
  id                    UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Nullable: manual/custom entries (added directly from
  -- /admin/dispatch-notifications for a dispatch that happened outside
  -- the normal flow) carry no backing job row.
  job_id                UUID,
  job_name              TEXT,
  po_number             TEXT    NOT NULL,
  party                 TEXT    NOT NULL,
  status                TEXT    NOT NULL,   -- 'Partial Dispatch' | 'Dispatched'
  qty                   INTEGER,
  remark                TEXT,
  -- The dispatch email needs to show each item's PM (printing/material)
  -- code. Job-triggered entries get it from jobs.pm_code; manual entries
  -- can have it typed in directly.
  pm_code               TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at           TIMESTAMPTZ,          -- NULL = still pending; set once the party email is sent
  -- Internal team is notified first, independently of the party email;
  -- bookkeeping only — does not affect what GET /api/dispatch-notifications
  -- returns (only notified_at does).
  internal_notified_at  TIMESTAMPTZ
);

-- Primary lookup pattern: WHERE party = $1 AND notified_at IS NULL
CREATE INDEX idx_pending_dispatch_notifications_pending
  ON pending_dispatch_notifications (party)
  WHERE notified_at IS NULL;

ALTER TABLE pending_dispatch_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dispatch/Admin can read pending dispatch notifications"
  ON pending_dispatch_notifications FOR SELECT
  TO authenticated
  USING (dept_has_permission('dispatch_notifications'));

CREATE POLICY "Dispatch/Admin can update pending dispatch notifications"
  ON pending_dispatch_notifications FOR UPDATE
  TO authenticated
  USING (dept_has_permission('dispatch_notifications'));

-- Manual entries are inserted from the browser (authenticated session),
-- unlike the service-role insert from the status route. See the note at
-- the top of this file re: current_dept() vs dept_has_permission().
CREATE POLICY "Dispatch/Admin can insert pending dispatch notifications"
  ON pending_dispatch_notifications FOR INSERT
  TO authenticated
  WITH CHECK (current_dept() IN ('Dispatch', 'Admin'));

CREATE POLICY "Dispatch/Admin can delete pending dispatch notifications"
  ON pending_dispatch_notifications FOR DELETE
  TO authenticated
  USING (current_dept() IN ('Dispatch', 'Admin'));

-- Sent rows aren't deleted immediately (their email is retrievable from
-- the inbox), but there's no reason to keep growing the table forever —
-- keeps at most the 100 most-recently-sent rows.
CREATE OR REPLACE FUNCTION trim_dispatch_notification_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM pending_dispatch_notifications
  WHERE notified_at IS NOT NULL
    AND id NOT IN (
      SELECT id FROM pending_dispatch_notifications
      WHERE notified_at IS NOT NULL
      ORDER BY notified_at DESC
      LIMIT 100
    );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trim_dispatch_notification_history_trigger
  AFTER UPDATE OF notified_at ON pending_dispatch_notifications
  FOR EACH STATEMENT
  EXECUTE FUNCTION trim_dispatch_notification_history();
