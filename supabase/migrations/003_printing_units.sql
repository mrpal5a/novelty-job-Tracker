-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 003: printing_units
-- ============================================================
-- Consolidated from original migration 012's printing_units half (the
-- jobs.printing_method / printing_unit_id columns and their assignment
-- trigger live in 004_jobs_core.sql, since they belong to the jobs
-- table and need this table to exist first for the FK).
--
-- Admin creates units in the admin panel: a name ('Unit-1') plus the
-- printing method that unit runs ('Offset' | 'Flexo').
-- ============================================================

CREATE TABLE printing_units (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL UNIQUE,          -- 'Unit-1'
  printing_method  TEXT NOT NULL
                     CHECK (printing_method IN ('Offset', 'Flexo')),
  -- Lowest sort_order among active units of a method is that method's
  -- default. Ties break on created_at then id so the pick is total and
  -- never flips between calls.
  sort_order       INTEGER NOT NULL DEFAULT 0,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_printing_units_method_active
  ON printing_units (printing_method, is_active, sort_order);

CREATE TRIGGER set_printing_units_updated_at
  BEFORE UPDATE ON printing_units
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

-- Named exactly as the floor refers to them. Admin can rename these,
-- deactivate them, or add more from the admin panel.
INSERT INTO printing_units (name, printing_method, sort_order)
VALUES
  ('Unit-1', 'Offset', 1),
  ('Unit-2', 'Flexo',  2);


-- ── Row Level Security ────────────────────────────────────────
-- Authenticated staff read; writes go through the service-role admin
-- client in the API layer, which is where department authorisation is
-- enforced.
ALTER TABLE printing_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "printing_units_select_authenticated"
  ON printing_units FOR SELECT
  TO authenticated
  USING (true);
