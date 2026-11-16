-- ============================================================
-- 096_dispatch_entry_states.sql
-- A dispatch entry (pending_dispatch_notifications) has no single "state"
-- column: its state is read off five fields, in a dozen places in the app.
-- These are the states the app already means, written down once:
--
--   In the queue        notified_at IS NULL  AND removed_at IS NULL
--   Left the queue      notified_at IS NOT NULL            (History tab)
--   Team emailed        internal_notified_at IS NOT NULL
--   Counts as dispatched  confirmed_at IS NOT NULL AND removed_at IS NULL
--                       (Reports, Job Separation "Dispatched")
--   Removed             removed_at IS NOT NULL  (reason required — 085)
--   Linked to a line    line_id IS NOT NULL     (wins over PO + PM matching)
--
-- `status` is not the entry's state: it is the job's stage when the entry
-- was made, and only ever one of two values.
--
-- Every row satisfied the rules below when this was written (2026-11-16).
-- They are here so a failed or half-finished write can't break them later.
-- ============================================================

-- 1. A team email is what makes an entry count (085). The app stamps the
--    email and the count in two separate writes; if the second one failed,
--    the team had been told and Reports never counted it. Now the first
--    write carries the second. The same trigger keeps a link's three fields
--    together — including when the linked line is deleted and the foreign
--    key blanks line_id on its own.
CREATE OR REPLACE FUNCTION public.dispatch_entry_keep_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.internal_notified_at IS NOT NULL AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at := NEW.internal_notified_at;
  END IF;
  IF NEW.line_id IS NULL THEN
    NEW.linked_by := NULL;
    NEW.linked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_entry_keep_consistent() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS dispatch_entry_keep_consistent ON public.pending_dispatch_notifications;
CREATE TRIGGER dispatch_entry_keep_consistent
  BEFORE INSERT OR UPDATE ON public.pending_dispatch_notifications
  FOR EACH ROW EXECUTE FUNCTION public.dispatch_entry_keep_consistent();

-- 2. The rules themselves, so nothing can store a state that means nothing.
ALTER TABLE public.pending_dispatch_notifications
  ADD CONSTRAINT pending_dispatch_team_email_counts
    CHECK (internal_notified_at IS NULL OR confirmed_at IS NOT NULL),
  ADD CONSTRAINT pending_dispatch_link_is_whole
    CHECK ((line_id IS NULL) = (linked_at IS NULL)),
  ADD CONSTRAINT pending_dispatch_status_is_a_dispatch_stage
    CHECK (status IN ('Dispatched', 'Partial Dispatch'));
