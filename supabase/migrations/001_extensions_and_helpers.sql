-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 001: Extensions + shared helper functions
-- ============================================================
-- Consolidated schema (replaces the original 001-058 migration history —
-- see docs/migrations-consolidation.md for the mapping). This file only
-- creates things every later migration depends on:
--   - uuid-ossp / pg_trgm extensions
--   - trigger_set_updated_at(): the generic "stamp updated_at = NOW()"
--     trigger function. The original history had ~10 near-identical
--     per-table copies of this (trigger_touch_dies, trigger_touch_plates,
--     trigger_touch_label_stock, trigger_touch_job_separations,
--     trigger_touch_register_accounts, trigger_touch_register_deals,
--     trigger_touch_bom_materials, trigger_touch_flatbed_dies,
--     trigger_touch_bom_costings, trigger_touch_bom_material_requests) —
--     all doing exactly `NEW.updated_at := NOW(); RETURN NEW;`. Every
--     table below reuses this single function instead.
--   - current_dept(): reads the department out of the caller's JWT.
--     Still used directly by a handful of RLS policies added after the
--     departments-table redesign (039/040) — see 013_dispatch_notifications.sql
--     for the specific policies that were never migrated to
--     dept_has_permission() and must stay on current_dept() to match live
--     behavior exactly.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ── Generic updated_at trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ── Department of the current authenticated user ────────────────
-- Reads from auth.jwt() -> 'user_metadata' ->> 'department'.
CREATE OR REPLACE FUNCTION current_dept()
RETURNS TEXT AS $$
  SELECT (auth.jwt() -> 'user_metadata' ->> 'department')::TEXT;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;
