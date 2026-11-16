-- ============================================================
-- 097_job_states.sql
-- A job's state is `status` (one of the 16 pipeline stages, the list in
-- src/lib/constants/stages.ts) plus a handful of flags that say things the
-- stage alone can't:
--
--   is_closed              the PO is closed. Always and only together with
--                          status = 'PO Closed'; nothing reopens a job.
--   has_partial_runs       the job is produced in print runs; dispatch is
--                          then recorded per run, not from the stage list.
--   is_scheduled_release   the job ships in planned releases.
--   slitting_confirmed_at  Postpress has confirmed slitting — what Quality
--                          Check waits for, not the 'Slitting' stage itself.
--   urgent / urgent_priority   priority (1–5) only means something while
--                          the job is urgent.
--   dispatched_qty         everything dispatched, by any route.
--   total_qty_dispatched   the part of it dispatched through runs/releases.
--
-- Every row satisfied the rules below when this was written (2026-11-16).
-- ============================================================

-- A priority left behind when "urgent" is switched off would sort the job
-- as urgent again the next time it is switched on, with a stale number.
CREATE OR REPLACE FUNCTION public.job_keep_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT NEW.urgent THEN
    NEW.urgent_priority := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.job_keep_consistent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS job_keep_consistent ON public.jobs;
CREATE TRIGGER job_keep_consistent
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.job_keep_consistent();

ALTER TABLE public.jobs
  -- The stage list, in the database too: a typo or an old stage name can't
  -- be stored and then silently fall out of every stage filter.
  ADD CONSTRAINT jobs_status_is_a_stage CHECK (status IN (
    'PO Received', 'Artwork Pending', 'Plate Status', 'Job Card Done',
    'Sample Printing', 'Shade Card Sent', 'Shade Card Approved', 'In Printing',
    'Slitting', 'Quality Check', 'Packing', 'Ready to Dispatch',
    'Partial Dispatch', 'Dispatched', 'On Hold', 'PO Closed'
  )),
  -- Half the app asks "is it closed?" by the flag, the other half by the
  -- stage. They must never disagree.
  ADD CONSTRAINT jobs_closed_means_po_closed CHECK ((status = 'PO Closed') = is_closed);
