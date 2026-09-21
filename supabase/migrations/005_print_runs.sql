-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 005: print_runs
-- ============================================================
-- Large orders are printed/dispatched in multiple cycles. Each cycle
-- (print run) moves through its own pipeline independently. Prepress
-- happens once per job, not per run.
--
-- Consolidates original migrations 003 (initial table, 4-stage
-- vocabulary), 005/006 (fixed a stage-vocabulary drift bug — the two
-- migrations that repaired it are collapsed away, only the final
-- corrected vocabulary + CHECK constraints are kept here), 007
-- (scheduled releases: extended to 6 stages + schedule_id link), 008
-- (qc_remark per run).
-- ============================================================

CREATE TABLE print_runs (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  run_number           INTEGER NOT NULL,        -- 1, 2, 3… auto-assigned per job (trigger below)
  qty_this_run         INTEGER NOT NULL CHECK (qty_this_run > 0),
  qty_remaining_after  INTEGER NOT NULL CHECK (qty_remaining_after >= 0),
  -- Mirrors every non-prepress job stage, since scheduled-release jobs
  -- dispatch in multiple releases and each release goes through the
  -- full production process.
  current_stage        TEXT NOT NULL DEFAULT 'Printing'
                         CHECK (current_stage IN ('Printing', 'Slitting', 'QC', 'Packing', 'Ready to Dispatch', 'Dispatched')),
  status               TEXT NOT NULL DEFAULT 'in_progress'
                         CHECK (status IN ('in_progress', 'dispatched')),
  started_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at        TIMESTAMPTZ,             -- NULL until this run is dispatched
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Links a run to the dispatch_schedules row it fulfils. The schedule is
  -- the PLANNING record (release number, planned date/qty); the run is
  -- the EXECUTION record. At most one run per schedule. Runs on
  -- non-scheduled jobs keep schedule_id NULL.
  schedule_id          UUID REFERENCES dispatch_schedules(id) ON DELETE SET NULL,
  -- QC works per release, so the QC remark belongs on the run, not only
  -- on the job. Written when QC advances a run out of the QC stage.
  qc_remark            TEXT,
  UNIQUE (job_id, run_number)                   -- one row per run per job
);

CREATE INDEX idx_print_runs_job_id ON print_runs (job_id);
CREATE INDEX idx_print_runs_status ON print_runs (job_id, status);
CREATE UNIQUE INDEX idx_print_runs_schedule_id
  ON print_runs (schedule_id) WHERE schedule_id IS NOT NULL;

COMMENT ON COLUMN print_runs.qc_remark IS
  'Optional QC remark for this run/release, captured when QC advances the run past the QC stage.';


-- ── Auto-assign run_number per job (1, 2, 3…) ──────────────────
-- Application may omit run_number; the trigger fills the next number for
-- that job. Explicit values are kept if provided.
CREATE OR REPLACE FUNCTION trigger_set_print_run_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.run_number IS NULL THEN
    SELECT COALESCE(MAX(run_number), 0) + 1
      INTO NEW.run_number
      FROM print_runs
     WHERE job_id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_print_run_number
  BEFORE INSERT ON print_runs
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_print_run_number();


-- ============================================================
-- TABLE: print_run_stage_logs
-- Append-only audit of every stage change per run.
-- ============================================================
CREATE TABLE print_run_stage_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  print_run_id  UUID NOT NULL REFERENCES print_runs(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL
                  CHECK (stage IN ('Printing', 'Slitting', 'QC', 'Packing', 'Ready to Dispatch', 'Dispatched')),
  changed_by    UUID REFERENCES auth.users(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes         TEXT
);

CREATE INDEX idx_prsl_print_run_id ON print_run_stage_logs (print_run_id);


-- ============================================================
-- ROW LEVEL SECURITY
-- Pattern matches the rest of the jobs pipeline:
--   SELECT/INSERT/UPDATE → all authenticated users (stage progression
--     validated in the API); DELETE → super-admin only.
--   Logs are append-only: no UPDATE/DELETE policies at all.
-- ============================================================

ALTER TABLE print_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_run_stage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read print runs"
  ON print_runs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert print runs"
  ON print_runs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);

CREATE POLICY "Authenticated users can update print runs"
  ON print_runs FOR UPDATE
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin can delete print runs"
  ON print_runs FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());

CREATE POLICY "Authenticated users can read print run logs"
  ON print_run_stage_logs FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Authenticated users can insert print run logs"
  ON print_run_stage_logs FOR INSERT
  TO authenticated
  WITH CHECK (TRUE);


-- ============================================================
-- CLIENT PORTAL ACCESS
-- The tracking portal (anon key) shows run progress per job. Stage logs
-- stay internal — no anon access.
-- ============================================================

GRANT SELECT ON print_runs TO anon;

CREATE POLICY "Anonymous can read print runs"
  ON print_runs FOR SELECT
  TO anon
  USING (TRUE);
