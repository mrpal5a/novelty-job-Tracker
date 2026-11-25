-- ============================================================
-- 111_manual_job_cards.sql
-- Job cards made by hand, for a job that isn't in Job Separation (yet).
--
--   manual   what a line would have given, typed: number, party, PM code, job
--            name, PO, quantity, and the colours when no plate has them.
--            NULL on a card made from a line.
--   Linking  when the order is entered later, the card is linked to its line
--            (and can be unlinked): it keeps its typed number, and its order
--            details come from the line the next time it is issued.
--   Number   typed by the team. Refused when another card or a line has it,
--            or when it looks like a Job Separation number (NOV26-55): that
--            series will reach it by itself one day.
--
-- party, pm_code, job_name, po_no and search_text: how a card is listed and
-- found, kept by the trigger from the print, the typed order or the line.
--
-- plate_artworks.job_card_id: artwork of a card that has no plate.
--
-- DEPLOY ORDER: apply BEFORE deploying the code. Cards made from lines work
-- exactly as before.
-- ============================================================

ALTER TABLE public.job_cards
  ALTER COLUMN job_separation_id DROP NOT NULL,
  ADD COLUMN manual   JSONB,
  ADD COLUMN party    TEXT,
  ADD COLUMN pm_code  TEXT,
  ADD COLUMN job_name TEXT,
  ADD COLUMN po_no    TEXT,
  ADD CONSTRAINT job_cards_line_or_manual CHECK (job_separation_id IS NOT NULL OR manual IS NOT NULL);

ALTER TABLE public.job_cards
  ADD COLUMN search_text text GENERATED ALWAYS AS (
    '|' || btrim(regexp_replace(lower(coalesce(card_number, '')), '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(po_no, '')),       '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(party, '')),       '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(job_name, '')),    '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),     '[^a-z0-9]+', ' ', 'g'))
 || '|'
  ) STORED;

CREATE INDEX idx_job_cards_search_text_trgm ON public.job_cards USING gin (search_text gin_trgm_ops);
CREATE INDEX idx_job_cards_created_at ON public.job_cards (created_at DESC);

ALTER TABLE public.plate_artworks
  ADD COLUMN job_card_id UUID REFERENCES public.job_cards(id) ON DELETE SET NULL;
CREATE INDEX idx_plate_artworks_job_card ON public.plate_artworks (job_card_id) WHERE job_card_id IS NOT NULL;

-- 107's rules, with manual cards.
CREATE OR REPLACE FUNCTION public.job_card_keep_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_line   public.job_separations%ROWTYPE;
  v_number TEXT;
BEGIN
  -- The line is locked first, so two people adding or issuing cards on it at
  -- once never get the same part or number.
  IF NEW.job_separation_id IS NOT NULL THEN
    SELECT * INTO v_line FROM public.job_separations WHERE id = NEW.job_separation_id FOR UPDATE;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.issued_at IS NOT NULL OR NEW.card_number IS NOT NULL THEN
      RAISE EXCEPTION 'A job card starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF (NEW.manual IS NULL) <> (OLD.manual IS NULL) THEN
      RAISE EXCEPTION 'A job card stays as it was made, by hand or from a line' USING ERRCODE = 'check_violation';
    END IF;
    -- Only a manual card is linked or unlinked, and never straight from one line to another.
    IF NEW.job_separation_id IS DISTINCT FROM OLD.job_separation_id
       AND (OLD.manual IS NULL OR (OLD.job_separation_id IS NOT NULL AND NEW.job_separation_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'A job card keeps its line and number' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.job_separation_id IS NOT DISTINCT FROM OLD.job_separation_id AND NEW.part <> OLD.part THEN
      RAISE EXCEPTION 'A job card keeps its line and number' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.card_number IS NOT NULL AND NEW.card_number IS DISTINCT FROM OLD.card_number THEN
      RAISE EXCEPTION 'A job card keeps its line and number' USING ERRCODE = 'check_violation';
    END IF;
    -- Links may still turn NULL (their record was deleted); the print may not change.
    IF OLD.issued_at IS NOT NULL AND NEW.issued_at IS NOT NULL
       AND (NEW.details IS DISTINCT FROM OLD.details OR NEW.issued_at <> OLD.issued_at) THEN
      RAISE EXCEPTION 'Job card % is issued: reopen it to change it', OLD.card_number USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Its place on the line: when made, and when linked or unlinked.
  IF TG_OP = 'INSERT' OR NEW.job_separation_id IS DISTINCT FROM OLD.job_separation_id THEN
    IF NEW.job_separation_id IS NULL THEN
      NEW.part := 1;
    ELSE
      IF v_line.cancelled_at IS NOT NULL AND TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'This line is cancelled' USING ERRCODE = 'check_violation';
      END IF;
      SELECT COALESCE(MAX(part), 0) + 1 INTO NEW.part
        FROM public.job_cards WHERE job_separation_id = NEW.job_separation_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL THEN
      IF v_line.cancelled_at IS NOT NULL THEN
        RAISE EXCEPTION 'This line is cancelled' USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.card_number IS NULL AND NEW.manual IS NOT NULL THEN
        v_number := upper(btrim(COALESCE(NEW.manual->>'number', '')));
        IF v_number = '' THEN
          RAISE EXCEPTION 'Type the job card number first' USING ERRCODE = 'check_violation';
        ELSIF v_number ~ '^[A-Z]{3}[0-9]{2}-[0-9]+(-[0-9]+)?$' THEN
          RAISE EXCEPTION '% is a Job Separation kind of number and would clash with it one day. Use another', v_number USING ERRCODE = 'check_violation';
        ELSIF EXISTS (SELECT 1 FROM public.job_cards WHERE upper(card_number) = v_number AND id <> NEW.id)
           OR EXISTS (SELECT 1 FROM public.job_separations WHERE upper(btrim(sr_no)) = v_number) THEN
          RAISE EXCEPTION 'Number % is already used', v_number USING ERRCODE = 'check_violation';
        END IF;
        NEW.card_number := v_number;
      ELSIF OLD.card_number IS NULL THEN
        IF COALESCE(btrim(v_line.sr_no), '') = '' THEN
          RAISE EXCEPTION 'This line has no Sr. No.' USING ERRCODE = 'check_violation';
        END IF;
        -- Alone on its line: the Sr. No. itself. ponytail: a card added after
        -- an issued "NOV26-55" becomes "NOV26-55-2"; the printed one stays.
        NEW.card_number := btrim(v_line.sr_no) || CASE
          WHEN EXISTS (SELECT 1 FROM public.job_cards
                        WHERE job_separation_id = NEW.job_separation_id AND id <> NEW.id)
            OR NEW.part > 1
          THEN '-' || NEW.part ELSE '' END;
      END IF;
    ELSIF OLD.card_number IS NULL AND NEW.card_number IS NOT NULL THEN
      RAISE EXCEPTION 'The number is given when the card is issued' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- How it is listed and found.
  IF NEW.details IS NOT NULL THEN
    NEW.party := NEW.details->>'party';      NEW.pm_code := NEW.details->>'pmCode';
    NEW.job_name := NEW.details->>'jobName'; NEW.po_no := NEW.details->>'poNumber';
  ELSIF NEW.job_separation_id IS NOT NULL THEN
    NEW.party := v_line.party;               NEW.pm_code := v_line.pm_code;
    NEW.job_name := v_line.material_name;    NEW.po_no := v_line.po_no;
  ELSE
    NEW.party := NEW.manual->>'party';       NEW.pm_code := NEW.manual->>'pm_code';
    NEW.job_name := NEW.manual->>'job_name'; NEW.po_no := NEW.manual->>'po_no';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.job_card_keep_consistent() FROM PUBLIC, anon, authenticated;

-- Cards made before this: through the trigger once, so they can be found.
UPDATE public.job_cards SET part_name = part_name;
