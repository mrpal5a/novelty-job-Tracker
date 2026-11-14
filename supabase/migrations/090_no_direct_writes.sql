-- ============================================================
-- 090_no_direct_writes.sql
-- Logged-in accounts can no longer write the job pipeline tables
-- directly through the Supabase API.
--
-- These eight tables had write policies of WITH CHECK (true) /
-- USING (true), so any signed-in account could edit jobs or forge
-- status history by calling /rest/v1 with its own token, skipping the
-- department checks that live in the API routes. Nothing in the app
-- needs those policies: every write to these tables goes through the
-- service-role client (createAdminClient) after the route has checked
-- the caller's department. Triggers on the session-written tables
-- (shade_cards, messages) don't touch these eight either.
--
-- Reads are unchanged: server pages and Realtime still read as the
-- signed-in user.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert jobs"            ON public.jobs;
DROP POLICY IF EXISTS "Authenticated users can update jobs"            ON public.jobs;
DROP POLICY IF EXISTS "Admin can delete jobs"                          ON public.jobs;

DROP POLICY IF EXISTS "Authenticated users can insert status logs"     ON public.job_status_logs;

DROP POLICY IF EXISTS "Authenticated users can insert stage timestamps" ON public.job_stage_timestamps;
DROP POLICY IF EXISTS "Admin can delete stage timestamps"              ON public.job_stage_timestamps;

DROP POLICY IF EXISTS "Authenticated users can insert print runs"      ON public.print_runs;
DROP POLICY IF EXISTS "Authenticated users can update print runs"      ON public.print_runs;
DROP POLICY IF EXISTS "Admin can delete print runs"                    ON public.print_runs;

DROP POLICY IF EXISTS "Authenticated users can insert print run logs"  ON public.print_run_stage_logs;

DROP POLICY IF EXISTS "Authenticated users can insert stage comments"  ON public.stage_comments;

DROP POLICY IF EXISTS "Authenticated users can insert dispatch schedules" ON public.dispatch_schedules;
DROP POLICY IF EXISTS "Dispatch and Admin can update schedules"        ON public.dispatch_schedules;
DROP POLICY IF EXISTS "Admin can delete dispatch schedules"            ON public.dispatch_schedules;

DROP POLICY IF EXISTS "Authenticated users can insert dispatch log"    ON public.on_time_dispatch_log;

-- Belt and braces: no write grants either, so a future permissive
-- policy can't silently reopen this.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.jobs, public.job_status_logs, public.job_stage_timestamps,
  public.print_runs, public.print_run_stage_logs, public.stage_comments,
  public.dispatch_schedules, public.on_time_dispatch_log
FROM anon, authenticated;
