-- ============================================================
-- Material ₹/m² rates and expense closed to logins — what 081 meant to do.
--
-- 081_bom_rates_view was never applied to the live database (found
-- 2026-11-21: no schema_migrations row, and authenticated still held
-- table-wide SELECT on both tables), so any login with bom_use could read
-- rates and expense straight from Supabase even without bom_rates_view.
-- This does 081's work, and also closes bom_material_requests.order_value:
-- it is the Job Separation order value copied onto the request, and 104
-- closed the original to logins.
--
-- No app change needed: every read of these columns already goes through
-- the service-role client after canDeptSeeMaterialRates; the session reads
-- left (the pending-request badge count, material names on paper rolls and
-- stock movements) use only columns granted below.
--
-- A column added to either table later is closed to logins until it is
-- granted here.
-- ============================================================

REVOKE SELECT ON bom_materials FROM anon, authenticated;
GRANT SELECT (id, name, name_key, specification, created_by, created_at, updated_at, is_active, updated_by)
  ON bom_materials TO authenticated;

REVOKE SELECT ON bom_material_requests FROM anon, authenticated;
GRANT SELECT (id, ref, job_separation_id, material_id, material_name, material_width_mm, running_meter,
              message, status, decision_note, decided_at, decided_by,
              requested_by_department, requested_by, created_at, updated_at, received_at, order_id)
  ON bom_material_requests TO authenticated;
