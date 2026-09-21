-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 004: jobs pipeline core
-- ============================================================
-- The heart of the app: jobs + every table/view directly hung off it.
-- Consolidates original migrations 001 (initial schema), 003 (partial
-- print-run columns on jobs), 004/006/039 (client_job_view /
-- client_status_log_view, each redefined more than once), 011 (job
-- card numbers), 012 (printing method/unit columns — table itself is
-- 003_printing_units.sql), 015 (Postpress dept added to the
-- changed_by_dept check, later superseded), 016 (stage_comments
-- attribution), 018 (slitting confirmation), 039 (changed_by_dept
-- check loosened to any non-empty department key, once departments
-- became data-driven).
-- ============================================================


-- ============================================================
-- TABLE: jobs
-- Core job record. One row per PO + PM code combination.
-- ============================================================
CREATE TABLE jobs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  po_number             TEXT NOT NULL,
  pm_code               TEXT,
  party                 TEXT NOT NULL,
  job_name              TEXT,
  label_qty             INTEGER,
  po_date               DATE,
  delivery_date         DATE,
  status                TEXT NOT NULL DEFAULT 'PO Received',
  job_type              TEXT NOT NULL DEFAULT 'New'
                          CHECK (job_type IN ('New', 'Repeat', 'Artwork Changed')),
  urgent                BOOLEAN NOT NULL DEFAULT FALSE,
  urgent_priority       INTEGER CHECK (urgent_priority BETWEEN 1 AND 5),
  notes                 TEXT,
  dispatched_qty        INTEGER NOT NULL DEFAULT 0,
  remaining_qty         INTEGER,  -- computed on insert/update; kept in sync via trigger
  halt_remark           TEXT,
  qc_remark             TEXT,
  is_scheduled_release  BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Partial print runs (originally migration 003): cumulative qty
  -- dispatched via print runs, and whether this job has ever created one.
  -- jobs.dispatched_qty (synced by trigger below) remains for the classic
  -- Partial Dispatch flow. A job uses ONE flow or the other — enforced in
  -- the application layer.
  total_qty_dispatched  INTEGER NOT NULL DEFAULT 0,
  has_partial_runs      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Job card number, auto-assigned by trigger below (originally 011).
  job_card_number       TEXT,

  -- Printing method + assigned unit (originally 012).
  printing_method       TEXT NOT NULL DEFAULT 'Flexo'
                          CHECK (printing_method IN ('Offset', 'Flexo')),
  -- ON DELETE SET NULL, not CASCADE: retiring a unit must never delete
  -- the jobs that ran on it.
  printing_unit_id      UUID REFERENCES printing_units(id) ON DELETE SET NULL,

  -- Real completion signal for the Slitting stage (originally 018).
  -- jobs.status flips to 'Slitting' the instant Production clicks
  -- Complete on the machine board — that is not proof Postpress finished
  -- slitting. This column is set when Postpress (or Admin) explicitly
  -- confirms, either via the manual status dropdown or the dedicated
  -- POST /api/jobs/[id]/confirm-slitting endpoint. Gates the Quality
  -- Check prerequisite.
  slitting_confirmed_at TIMESTAMPTZ
);

-- Index for the most common lookups
CREATE INDEX idx_jobs_po_number     ON jobs (po_number);
CREATE INDEX idx_jobs_party         ON jobs (party);
CREATE INDEX idx_jobs_status        ON jobs (status);
CREATE INDEX idx_jobs_delivery_date ON jobs (delivery_date);
CREATE INDEX idx_jobs_is_closed     ON jobs (is_closed);
CREATE INDEX idx_jobs_urgent        ON jobs (urgent, urgent_priority);
CREATE INDEX idx_jobs_status_on_hold ON jobs (status) WHERE status = 'On Hold';
CREATE INDEX idx_jobs_printing_unit_id ON jobs (printing_unit_id);

-- Trigram indexes for leading-wildcard ILIKE search (admin search +
-- the public /track/[po] portal). A plain btree can't serve `%term%`.
CREATE INDEX idx_jobs_job_card_number_trgm ON jobs USING GIN (job_card_number gin_trgm_ops);
CREATE INDEX idx_jobs_po_number_trgm       ON jobs USING GIN (po_number gin_trgm_ops);
CREATE INDEX idx_jobs_party_trgm           ON jobs USING GIN (party gin_trgm_ops);
CREATE INDEX idx_jobs_job_name_trgm        ON jobs USING GIN (job_name gin_trgm_ops);
CREATE INDEX idx_jobs_pm_code_trgm         ON jobs USING GIN (pm_code gin_trgm_ops);


-- ============================================================
-- TABLE: job_stage_timestamps
-- One row per (job, stage) once that stage is completed.
-- Used for prerequisite enforcement.
-- ============================================================
CREATE TABLE job_stage_timestamps (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, stage)  -- only one completion record per stage per job
);

CREATE INDEX idx_jst_job_id ON job_stage_timestamps (job_id);


-- ============================================================
-- TABLE: job_status_logs
-- Permanent audit log. Never deleted. Every status change ever.
-- ============================================================
CREATE TABLE job_status_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status            TEXT NOT NULL,
  -- Originally a fixed enum of 5, then 6 departments (migrations 001,
  -- 015). Loosened here to "any non-empty department key" once
  -- departments became data-driven (migration 039) — a new department
  -- can write status logs without a schema change.
  changed_by_dept   TEXT NOT NULL CHECK (changed_by_dept IS NOT NULL AND changed_by_dept <> ''),
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  remark            TEXT,         -- halt_remark or qc_remark; NULL otherwise
  qty_dispatched    INTEGER       -- only for Partial Dispatch or Dispatched; NULL otherwise
);

CREATE INDEX idx_jsl_job_id    ON job_status_logs (job_id);
CREATE INDEX idx_jsl_changed_at ON job_status_logs (changed_at DESC);
-- Jobs dispatched this month (dashboard summary card).
CREATE INDEX idx_jsl_dispatched_this_month
  ON job_status_logs (changed_at)
  WHERE status = 'Dispatched';


-- ============================================================
-- TABLE: stage_comments
-- Internal only. Per-stage comment threads. Never shown to clients.
-- Also doubles as the global internal-note feed ("Notes" box).
-- ============================================================
CREATE TABLE stage_comments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id            UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  stage             TEXT NOT NULL,
  comment           TEXT NOT NULL,
  created_by        TEXT NOT NULL,   -- department name
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Email of the staff account that wrote the note (originally 016), so
  -- the Notes feed can attribute to a person, not just a department.
  -- Nullable: notes written before this column existed have no email.
  created_by_email  TEXT
);

CREATE INDEX idx_sc_job_id ON stage_comments (job_id);
CREATE INDEX idx_sc_stage  ON stage_comments (job_id, stage);
-- Feed query: "newest N notes across all jobs" / "newer than <ts>" for
-- the unread count — both job-scoped indexes above can't serve an
-- unfiltered ORDER BY created_at DESC without a full scan + sort.
CREATE INDEX idx_sc_created_at ON stage_comments (created_at DESC);


-- ============================================================
-- TABLE: dispatch_schedules
-- Only used when jobs.is_scheduled_release = true.
-- One row per planned release. Stays in place even after dispatch.
-- ============================================================
CREATE TABLE dispatch_schedules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  release_number  INTEGER NOT NULL,
  planned_qty     INTEGER NOT NULL,
  planned_date    DATE NOT NULL,
  actual_qty      INTEGER,      -- NULL until dispatched
  actual_date     TIMESTAMPTZ,  -- NULL until dispatched
  status          TEXT NOT NULL DEFAULT 'Pending'
                    CHECK (status IN ('Pending', 'In Progress', 'Dispatched')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, release_number)
);

CREATE INDEX idx_ds_job_id ON dispatch_schedules (job_id);
CREATE INDEX idx_ds_planned_date ON dispatch_schedules (planned_date);


-- ============================================================
-- TABLE: on_time_dispatch_log
-- Appended to when any job is marked Dispatched.
-- Powers the "On-time delivery: X% this month" dashboard card.
-- ============================================================
CREATE TABLE on_time_dispatch_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  dispatched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivery_date   DATE,         -- the delivery_date at time of dispatch
  is_on_time      BOOLEAN,      -- TRUE if dispatched_at::date <= delivery_date
  month_key       TEXT          -- 'YYYY-MM' for easy monthly aggregation
);

CREATE INDEX idx_otdl_month_key ON on_time_dispatch_log (month_key);
CREATE INDEX idx_otdl_job_id    ON on_time_dispatch_log (job_id);


-- ============================================================
-- TABLE: job_card_counters
-- One row per period ('jul26'), holding the last sequence issued for
-- job_card_number: <mon><yy>-<seq>, e.g. jul26-1. Month boundary is
-- evaluated in Asia/Kolkata, not UTC, so a job added at 00:30 IST on
-- 1 Aug files under aug26, not jul26.
--
-- A counter table rather than MAX(seq)+1 over jobs: that read is not
-- atomic, and this counter is global per month — every job in the shop
-- contends for it — so two clerks adding jobs at the same moment could
-- read the same MAX and collide. The UPSERT below takes a row lock and
-- increments in one statement, so concurrent inserts serialise
-- correctly.
-- ============================================================
CREATE TABLE job_card_counters (
  period    TEXT    PRIMARY KEY,          -- 'jul26'
  last_seq  INTEGER NOT NULL DEFAULT 0
);

-- STABLE only (not IMMUTABLE): the AT TIME ZONE conversion depends on
-- the timezone database.
CREATE OR REPLACE FUNCTION job_card_period(ts TIMESTAMPTZ)
RETURNS TEXT AS $$
  SELECT lower(to_char(ts AT TIME ZONE 'Asia/Kolkata', 'MonYY'));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION trigger_set_job_card_number()
RETURNS TRIGGER AS $$
DECLARE
  v_period TEXT;
  v_seq    INTEGER;
BEGIN
  -- An explicitly supplied number wins, so data imports and manual
  -- corrections can pin a specific card number without the trigger
  -- overwriting it.
  IF NEW.job_card_number IS NOT NULL AND btrim(NEW.job_card_number) <> '' THEN
    RETURN NEW;
  END IF;

  v_period := job_card_period(COALESCE(NEW.created_at, NOW()));

  INSERT INTO job_card_counters (period, last_seq)
       VALUES (v_period, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_seq = job_card_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  NEW.job_card_number := v_period || '-' || v_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_job_card_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_job_card_number();

-- Safety net: if the counter is ever bypassed or hand-edited, a
-- duplicate card number fails loudly at write time.
CREATE UNIQUE INDEX idx_jobs_job_card_number ON jobs (job_card_number);
-- Lookup by card number is a primary prepress workflow.
CREATE INDEX idx_jobs_job_card_number_lower ON jobs (lower(job_card_number));


-- ============================================================
-- Printing unit default-assignment (originally 012)
-- ============================================================
CREATE OR REPLACE FUNCTION default_printing_unit(p_method TEXT)
RETURNS UUID AS $$
  SELECT id
    FROM printing_units
   WHERE printing_method = p_method
     AND is_active
   ORDER BY sort_order, created_at, id
   LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION trigger_set_job_printing_unit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Only fill an unassigned unit, so a caller that names a unit
    -- explicitly at creation keeps it.
    IF NEW.printing_unit_id IS NULL THEN
      NEW.printing_unit_id := default_printing_unit(NEW.printing_method);
    END IF;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Method changed and the caller did NOT also set a unit in the same
    -- statement => snap to the new method's default. If the caller did
    -- set a unit, that is an explicit override and wins.
    IF NEW.printing_method IS DISTINCT FROM OLD.printing_method
       AND NEW.printing_unit_id IS NOT DISTINCT FROM OLD.printing_unit_id THEN
      NEW.printing_unit_id := default_printing_unit(NEW.printing_method);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_job_printing_unit
  BEFORE INSERT OR UPDATE OF printing_method, printing_unit_id ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_job_printing_unit();


-- ============================================================
-- TRIGGERS: updated_at + remaining_qty sync
-- ============================================================
CREATE TRIGGER set_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- remaining_qty = label_qty - dispatched_qty
CREATE OR REPLACE FUNCTION trigger_sync_remaining_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.label_qty IS NOT NULL THEN
    NEW.remaining_qty = NEW.label_qty - COALESCE(NEW.dispatched_qty, 0);
  ELSE
    NEW.remaining_qty = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_remaining_qty
  BEFORE INSERT OR UPDATE OF label_qty, dispatched_qty ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_sync_remaining_qty();


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

ALTER TABLE jobs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_stage_timestamps ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_status_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stage_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE on_time_dispatch_log ENABLE ROW LEVEL SECURITY;

-- ── jobs ──────────────────────────────────────────────────────

CREATE POLICY "Authenticated users can read all jobs"
  ON jobs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert jobs"
  ON jobs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- Stage-level locking is enforced in the application layer, not SQL,
-- because it depends on job_type and prerequisite logic too complex for
-- a CHECK constraint. What we CAN enforce here: only authenticated
-- users update.
CREATE POLICY "Authenticated users can update jobs"
  ON jobs FOR UPDATE
  TO authenticated
  USING (TRUE);

-- Hard delete: super-admin only, no independently grantable feature_key
-- has ever existed for this.
CREATE POLICY "Admin can delete jobs"
  ON jobs FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());


-- ── job_stage_timestamps ──────────────────────────────────────

CREATE POLICY "Authenticated users can read stage timestamps"
  ON job_stage_timestamps FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert stage timestamps"
  ON job_stage_timestamps FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- No updates — append-only. If a stage is redone, insert a new row
-- (UNIQUE constraint prevents duplicates; application must DELETE then
-- INSERT if re-stamping a stage — Admin only).
CREATE POLICY "Admin can delete stage timestamps"
  ON job_stage_timestamps FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());


-- ── job_status_logs ───────────────────────────────────────────

CREATE POLICY "Authenticated users can read status logs"
  ON job_status_logs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert status logs"
  ON job_status_logs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- NO update or delete policies — permanent audit trail.


-- ── stage_comments ────────────────────────────────────────────

CREATE POLICY "Authenticated users can read stage comments"
  ON stage_comments FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert stage comments"
  ON stage_comments FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

-- Comments are not edited or deleted (append-only like logs).


-- ── dispatch_schedules ────────────────────────────────────────

CREATE POLICY "Authenticated users can read dispatch schedules"
  ON dispatch_schedules FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert dispatch schedules"
  ON dispatch_schedules FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

CREATE POLICY "Dispatch and Admin can update schedules"
  ON dispatch_schedules FOR UPDATE
  TO authenticated
  USING (dept_has_permission('delivery_date_edit'));

CREATE POLICY "Admin can delete dispatch schedules"
  ON dispatch_schedules FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());


-- ── on_time_dispatch_log ──────────────────────────────────────

CREATE POLICY "Authenticated users can read dispatch log"
  ON on_time_dispatch_log FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert dispatch log"
  ON on_time_dispatch_log FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);


-- ============================================================
-- CLIENT PORTAL: Anonymous read access
-- The client tracking portal (the deployment's /track route) uses an
-- anonymous Supabase key — no login required. Clients can only read
-- jobs and dispatch_schedules via these views/grants. They CANNOT see
-- stage_comments (internal) or job_status_logs directly.
-- ============================================================

CREATE OR REPLACE VIEW client_job_view AS
SELECT
  j.id,
  j.po_number,
  j.pm_code,
  j.party,
  j.job_name,
  j.label_qty,
  j.po_date,
  j.delivery_date,
  j.status,
  j.job_type,
  j.urgent,
  j.urgent_priority,
  j.notes,
  j.dispatched_qty,
  j.remaining_qty,
  j.halt_remark,
  j.qc_remark,
  j.is_scheduled_release,
  j.is_closed,
  j.created_at,
  j.updated_at,
  j.total_qty_dispatched,
  j.has_partial_runs
FROM jobs j;

ALTER VIEW client_job_view OWNER TO postgres;

GRANT SELECT ON client_job_view TO anon;
GRANT SELECT ON dispatch_schedules TO anon;
-- Progress bar calculation on the client portal.
GRANT SELECT ON job_stage_timestamps TO anon;

-- Client-safe status log view: strips internal department identity down
-- to a display name. Reads client_facing_name from `departments` (falls
-- back to display_name, then "<dept> Team") so a newly created
-- department shows up correctly with no code change.
CREATE OR REPLACE VIEW client_status_log_view AS
SELECT
  jsl.id,
  jsl.job_id,
  jsl.status,
  COALESCE(d.client_facing_name, d.display_name, jsl.changed_by_dept || ' Team') AS department_display,
  jsl.changed_at,
  jsl.remark,       -- halt_remark or qc_remark — visible to client per spec
  jsl.qty_dispatched
FROM job_status_logs jsl
LEFT JOIN departments d ON d.key = jsl.changed_by_dept;

ALTER VIEW client_status_log_view OWNER TO postgres;
GRANT SELECT ON client_status_log_view TO anon;
