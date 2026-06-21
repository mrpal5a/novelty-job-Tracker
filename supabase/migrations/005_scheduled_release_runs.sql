-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 005: Scheduled-Release multi-cycle runs
-- Run AFTER 004_client_view_print_runs.sql
-- ============================================================
-- Each "release" is a print_run with a planned qty + delivery
-- date, moving through the full 6-stage production pipeline.
-- Per-step timestamps (print_run_stage_logs) are exposed to the
-- client portal through a client-safe view (changed_by + notes
-- stripped).
-- ============================================================

-- ── 1. New columns on print_runs ─────────────────────────────
ALTER TABLE print_runs ADD COLUMN IF NOT EXISTS planned_qty  INTEGER;
ALTER TABLE print_runs ADD COLUMN IF NOT EXISTS planned_date DATE;

-- ── 2. Expand current_stage from 4 to 6 production stages ─────
-- Drop the old CHECK, migrate legacy values, add the new CHECK.
ALTER TABLE print_runs DROP CONSTRAINT IF EXISTS print_runs_current_stage_check;

-- Map any legacy rows to the new vocabulary.
UPDATE print_runs SET current_stage = 'In Printing'   WHERE current_stage = 'Printing';
UPDATE print_runs SET current_stage = 'Quality Check' WHERE current_stage = 'QC';
-- 'Packing' and 'Dispatched' keep the same name.

ALTER TABLE print_runs
  ALTER COLUMN current_stage SET DEFAULT 'In Printing';

ALTER TABLE print_runs
  ADD CONSTRAINT print_runs_current_stage_check
  CHECK (current_stage IN (
    'In Printing', 'Slitting', 'Quality Check',
    'Packing', 'Ready to Dispatch', 'Dispatched'
  ));

-- ── 3. Client-safe view of stage logs (per-step timestamps) ──
-- Strips changed_by (auth user id) and notes (internal).
CREATE OR REPLACE VIEW client_print_run_stage_log_view AS
SELECT
  prsl.id,
  prsl.print_run_id,
  prsl.stage,
  prsl.changed_at
FROM print_run_stage_logs prsl;

ALTER VIEW client_print_run_stage_log_view OWNER TO postgres;
GRANT SELECT ON client_print_run_stage_log_view TO anon;
GRANT SELECT ON client_print_run_stage_log_view TO authenticated;

-- ============================================================
-- Done. Next: TypeScript types (Task 2).
-- ============================================================
