-- ============================================================
-- Migration 107: job_cards
-- ============================================================
-- One row per job card. A Job Separation line has one card per plate
-- (front, back, base), so usually one. The card links to the records it is
-- filled from and keeps only what they don't hold (src/lib/jobCard.ts).
--
--   Draft   issued_at NULL: follows its plate, die and shade card live.
--   Issued  `details` is the card exactly as printed and can't change, so
--           correcting a plate later never alters a printed card. Reopen
--           (issued_at and details back to NULL) to correct it.
--
-- Number: the line's own Sr. No. (NOV26-55); with several cards on the line,
-- NOV26-55-1, NOV26-55-2. Given at first issue and kept from then on.
-- The jobs table's own series (job_card_counters) is not touched.
--
-- Issuing never touches the line: JC Status stays typed by hand.
-- Purely additive: no existing table is altered.
-- ============================================================

CREATE TABLE public.job_cards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_separation_id  UUID NOT NULL REFERENCES public.job_separations(id) ON DELETE RESTRICT,
  part               SMALLINT NOT NULL,          -- 1, 2, 3… set on insert
  part_name          TEXT,                       -- FRONT, BACK, BASE
  card_number        TEXT UNIQUE,                -- set at first issue, then kept

  plate_id           UUID REFERENCES public.plates(id)        ON DELETE SET NULL,
  die_id             UUID REFERENCES public.dies(id)          ON DELETE SET NULL,
  flatbed_die_id     UUID REFERENCES public.flatbed_dies(id)  ON DELETE SET NULL,
  shade_card_id      UUID REFERENCES public.shade_cards(id)   ON DELETE SET NULL,
  material_id        UUID REFERENCES public.bom_materials(id) ON DELETE SET NULL,
  layout             JSONB,                      -- which way round, when picked

  roll_sheet         TEXT CHECK (roll_sheet IN ('ROLL', 'SHEET')),
  direction          TEXT,                       -- UNWIND#3
  material           TEXT,                       -- as printed
  material_width_mm  NUMERIC(6,2) CHECK (material_width_mm > 0),
  labels_per_roll    INTEGER CHECK (labels_per_roll > 0),
  delivery_date      DATE,
  overrides          JSONB NOT NULL DEFAULT '{}', -- boxes typed over, by name

  details            JSONB,                      -- the card as printed
  issued_at          TIMESTAMPTZ,
  issued_by          TEXT,

  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (job_separation_id, part),
  CONSTRAINT job_cards_one_die    CHECK (die_id IS NULL OR flatbed_die_id IS NULL),
  CONSTRAINT job_cards_issued_all CHECK ((issued_at IS NULL) = (details IS NULL)
                                     AND (issued_at IS NULL OR card_number IS NOT NULL))
);

-- "The last card of this plate", and the links' own ON DELETE lookups.
CREATE INDEX idx_job_cards_plate_id       ON public.job_cards (plate_id);
CREATE INDEX idx_job_cards_die_id         ON public.job_cards (die_id)         WHERE die_id IS NOT NULL;
CREATE INDEX idx_job_cards_flatbed_die_id ON public.job_cards (flatbed_die_id) WHERE flatbed_die_id IS NOT NULL;
CREATE INDEX idx_job_cards_shade_card_id  ON public.job_cards (shade_card_id)  WHERE shade_card_id IS NOT NULL;
CREATE INDEX idx_job_cards_material_id    ON public.job_cards (material_id)    WHERE material_id IS NOT NULL;

-- The rules above, whoever writes. The line is locked first, so two people
-- adding or issuing cards on it at once never get the same part or number.
CREATE OR REPLACE FUNCTION public.job_card_keep_consistent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_sr_no TEXT;
  v_cancelled TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.card_number IS NOT NULL THEN
      RAISE EXCEPTION 'Job card % has been issued and cannot be deleted', OLD.card_number
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public.job_separations WHERE id = NEW.job_separation_id FOR UPDATE;
    SELECT COALESCE(MAX(part), 0) + 1 INTO NEW.part
      FROM public.job_cards WHERE job_separation_id = NEW.job_separation_id;
    IF NEW.issued_at IS NOT NULL OR NEW.card_number IS NOT NULL THEN
      RAISE EXCEPTION 'A job card starts as a draft' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.job_separation_id <> OLD.job_separation_id OR NEW.part <> OLD.part
     OR (OLD.card_number IS NOT NULL AND NEW.card_number IS DISTINCT FROM OLD.card_number) THEN
    RAISE EXCEPTION 'A job card keeps its line and number' USING ERRCODE = 'check_violation';
  END IF;

  -- Links may still turn NULL (their record was deleted); the print may not change.
  IF OLD.issued_at IS NOT NULL AND NEW.issued_at IS NOT NULL
     AND (NEW.details IS DISTINCT FROM OLD.details OR NEW.issued_at <> OLD.issued_at) THEN
    RAISE EXCEPTION 'Job card % is issued: reopen it to change it', OLD.card_number
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.issued_at IS NULL AND NEW.issued_at IS NOT NULL THEN
    SELECT sr_no, cancelled_at INTO v_sr_no, v_cancelled
      FROM public.job_separations WHERE id = NEW.job_separation_id FOR UPDATE;
    IF v_cancelled IS NOT NULL THEN
      RAISE EXCEPTION 'This line is cancelled' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.card_number IS NULL THEN
      IF COALESCE(btrim(v_sr_no), '') = '' THEN
        RAISE EXCEPTION 'This line has no Sr. No.' USING ERRCODE = 'check_violation';
      END IF;
      -- Alone on its line: the Sr. No. itself. ponytail: a card added after
      -- an issued "NOV26-55" becomes "NOV26-55-2"; the printed one stays.
      NEW.card_number := btrim(v_sr_no) || CASE
        WHEN EXISTS (SELECT 1 FROM public.job_cards
                      WHERE job_separation_id = NEW.job_separation_id AND id <> NEW.id)
          OR NEW.part > 1
        THEN '-' || NEW.part ELSE '' END;
    END IF;
  ELSIF OLD.card_number IS NULL AND NEW.card_number IS NOT NULL THEN
    RAISE EXCEPTION 'The number is given when the card is issued' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_card_keep_consistent
  BEFORE INSERT OR UPDATE OR DELETE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.job_card_keep_consistent();

REVOKE ALL ON FUNCTION public.job_card_keep_consistent() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER touch_job_cards
  BEFORE UPDATE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE TRIGGER log_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.job_cards
  FOR EACH ROW EXECUTE FUNCTION public.log_activity('card_number', 'part_name');

-- Every department reads; writes only through the API (service role).
ALTER TABLE public.job_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_cards_select_authenticated"
  ON public.job_cards FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.job_cards FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.job_cards FROM authenticated;
