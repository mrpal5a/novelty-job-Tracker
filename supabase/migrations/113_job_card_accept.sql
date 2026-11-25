-- ============================================================
-- Migration 113: Production accepts a job card
-- ============================================================
-- An issued card can be accepted (job_card_accept, given here to Production;
-- Admin always has it). From then on nobody changes it, Admin included: not
-- reopened, not deleted. Only cancelling the acceptance itself, alone, opens it
-- again. Admin's to do, which the API checks (as it does for deleting).
--
-- Still allowed, as none of it changes the print: a manual card is linked to
-- its order when that is entered, and a link turns NULL when the plate, die,
-- shade card or material it points at is deleted.
--
-- DEPLOY ORDER: apply BEFORE deploying the code (purely additive).
-- ============================================================

ALTER TABLE public.job_cards
  ADD COLUMN accepted_at TIMESTAMPTZ,
  ADD COLUMN accepted_by TEXT,
  ADD CONSTRAINT job_cards_accepted_all CHECK ((accepted_at IS NULL) = (accepted_by IS NULL)
                                           AND (accepted_at IS NULL OR issued_at IS NOT NULL));

INSERT INTO public.department_feature_permissions (department_id, feature_key)
SELECT id, 'job_card_accept' FROM public.departments WHERE key = 'Production'
ON CONFLICT DO NOTHING;

CREATE FUNCTION public.job_card_accepted_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  -- search_text is generated: not filled in yet in a BEFORE trigger.
  v_free TEXT[] := ARRAY['updated_at', 'search_text', 'job_separation_id', 'part',
                         'plate_id', 'die_id', 'flatbed_die_id', 'shade_card_id', 'material_id'];
BEGIN
  IF OLD.accepted_at IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF NEW.accepted_at IS NOT NULL THEN
      -- Accepting is all that happens: the card accepted is the one that was issued.
      IF OLD.issued_at IS NULL OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
        RAISE EXCEPTION 'Only an issued job card can be accepted' USING ERRCODE = 'check_violation';
      END IF;
      -- Locked, so the order can't be cancelled in between.
      PERFORM 1 FROM public.job_separations WHERE id = NEW.job_separation_id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM public.job_separations WHERE id = NEW.job_separation_id AND cancelled_at IS NOT NULL) THEN
        RAISE EXCEPTION 'This line is cancelled' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Job card % is accepted by Production and can no longer be deleted', OLD.card_number USING ERRCODE = 'check_violation';
  END IF;
  -- Cancelled by itself: every other column must be as it was.
  IF NEW.accepted_at IS NULL THEN
    v_free := v_free || ARRAY['accepted_at', 'accepted_by'];
  END IF;
  IF (to_jsonb(NEW) - v_free) IS DISTINCT FROM (to_jsonb(OLD) - v_free)
     OR (NEW.plate_id       IS NOT NULL AND NEW.plate_id       IS DISTINCT FROM OLD.plate_id)
     OR (NEW.die_id         IS NOT NULL AND NEW.die_id         IS DISTINCT FROM OLD.die_id)
     OR (NEW.flatbed_die_id IS NOT NULL AND NEW.flatbed_die_id IS DISTINCT FROM OLD.flatbed_die_id)
     OR (NEW.shade_card_id  IS NOT NULL AND NEW.shade_card_id  IS DISTINCT FROM OLD.shade_card_id)
     OR (NEW.material_id    IS NOT NULL AND NEW.material_id    IS DISTINCT FROM OLD.material_id) THEN
    RAISE EXCEPTION 'Job card % is accepted by Production and can no longer be changed', OLD.card_number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.job_card_accepted_lock() FROM PUBLIC, anon, authenticated;

-- Before job_card_keep_consistent (triggers fire by name): it sees the request as it was sent.
CREATE TRIGGER job_card_accepted_lock
  BEFORE UPDATE OR DELETE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.job_card_accepted_lock();
