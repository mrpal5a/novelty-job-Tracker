-- ============================================================
-- A Job Separation line's rate and order value are closed to logins.
--
-- The Viewer (read-only) login may be handed to people outside the office.
-- The app already leaves rate / order_value out for them
-- (canDeptSeePrices); this makes the database agree, so no login can read
-- them straight from Supabase with its session either. Logins keep every
-- other column; the routes read prices through the service-role client
-- after their own permission check (api/job-separations GET, api/jobs GET,
-- the dashboard page). BOM / Reports already read them that way.
--
-- Writes: every app write to job_separations goes through the service role
-- and RLS has no write policy, so the unused write grants go as well
-- (as migration 090 did for jobs and the logs).
--
-- A column added to job_separations later is closed to logins until it is
-- granted here — add it to the GRANT list if pages read it with a session.
--
-- Apply AFTER the app code that reads prices via the admin client is live:
-- the old code selects * with the user's session and would fail.
-- ============================================================

REVOKE SELECT ON job_separations FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON job_separations FROM anon, authenticated;
GRANT SELECT (id, sr_no, party, po_no, po_date, pm_code, material_name, quantity, unit,
              job_status, jc_status, aw_send_to, created_by, created_at, updated_at,
              linked_job_id, linked_job_card_number, cancelled_at, cancelled_by, cancel_reason,
              po_norm, pm_norm, search_text)
  ON job_separations TO authenticated;
