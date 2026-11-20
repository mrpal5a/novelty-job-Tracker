-- ============================================================
-- 101_plate_die_layout.sql
-- The layout fields a job card will need, entered once on the plate:
--
--   plates.total_colors   how many colours the job prints (1–12; the
--                         biggest press is 10 colours, 12 leaves room for
--                         a future 12-colour press). One plate per colour.
--   around_ups / around_gap / across_ups / across_gap
--                         labels and the gap between them, around the
--                         cylinder and across the web. On both tables:
--                         they describe the die, and the plate is made to
--                         match it.
--   plates.die_id         the roto die this plate runs with. Many plates
--                         can share one die.
--
-- The four layout fields are kept the same on a plate and its die:
--   * linking a plate with blank layout to a die copies the die's layout in;
--   * saving a linked plate writes its layout to the die;
--   * changing a die's layout writes it to every plate linked to it.
-- Each update only touches rows that differ, so the chain stops by itself.
--
-- dies.ups and dies.gap (the old "Ups per repeat" and "Gap across") stay
-- as they are; decided 2026-11-20.
-- ============================================================

ALTER TABLE public.dies
  ADD COLUMN around_ups  INTEGER      CHECK (around_ups > 0),
  ADD COLUMN around_gap  NUMERIC(6,2) CHECK (around_gap >= 0),
  ADD COLUMN across_ups  INTEGER      CHECK (across_ups > 0),
  ADD COLUMN across_gap  NUMERIC(6,2) CHECK (across_gap >= 0);

ALTER TABLE public.plates
  ADD COLUMN die_id       UUID REFERENCES public.dies(id) ON DELETE SET NULL,
  ADD COLUMN total_colors SMALLINT     CHECK (total_colors BETWEEN 1 AND 12),
  ADD COLUMN around_ups   INTEGER      CHECK (around_ups > 0),
  ADD COLUMN around_gap   NUMERIC(6,2) CHECK (around_gap >= 0),
  ADD COLUMN across_ups   INTEGER      CHECK (across_ups > 0),
  ADD COLUMN across_gap   NUMERIC(6,2) CHECK (across_gap >= 0);

CREATE INDEX idx_plates_die_id ON public.plates (die_id) WHERE die_id IS NOT NULL;

-- Newly linked with nothing typed: take the die's layout.
CREATE OR REPLACE FUNCTION public.plate_pull_die_layout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.die_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.die_id IS DISTINCT FROM OLD.die_id)
     AND NEW.around_ups IS NULL AND NEW.around_gap IS NULL
     AND NEW.across_ups IS NULL AND NEW.across_gap IS NULL
  THEN
    SELECT d.around_ups, d.around_gap, d.across_ups, d.across_gap
      INTO NEW.around_ups, NEW.around_gap, NEW.across_ups, NEW.across_gap
      FROM public.dies d WHERE d.id = NEW.die_id;
  END IF;
  RETURN NEW;
END;
$$;

-- A linked plate's layout is its die's layout.
CREATE OR REPLACE FUNCTION public.plate_push_die_layout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.die_id IS NOT NULL THEN
    UPDATE public.dies d
       SET around_ups = NEW.around_ups, around_gap = NEW.around_gap,
           across_ups = NEW.across_ups, across_gap = NEW.across_gap
     WHERE d.id = NEW.die_id
       AND (d.around_ups, d.around_gap, d.across_ups, d.across_gap)
           IS DISTINCT FROM (NEW.around_ups, NEW.around_gap, NEW.across_ups, NEW.across_gap);
  END IF;
  RETURN NULL;
END;
$$;

-- A die's layout reaches every plate linked to it.
CREATE OR REPLACE FUNCTION public.die_push_plate_layout()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.plates p
     SET around_ups = NEW.around_ups, around_gap = NEW.around_gap,
         across_ups = NEW.across_ups, across_gap = NEW.across_gap
   WHERE p.die_id = NEW.id
     AND (p.around_ups, p.around_gap, p.across_ups, p.across_gap)
         IS DISTINCT FROM (NEW.around_ups, NEW.around_gap, NEW.across_ups, NEW.across_gap);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.plate_pull_die_layout() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.plate_push_die_layout() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.die_push_plate_layout() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER plate_pull_die_layout
  BEFORE INSERT OR UPDATE OF die_id ON public.plates
  FOR EACH ROW EXECUTE FUNCTION public.plate_pull_die_layout();

CREATE TRIGGER plate_push_die_layout
  AFTER INSERT OR UPDATE OF die_id, around_ups, around_gap, across_ups, across_gap ON public.plates
  FOR EACH ROW EXECUTE FUNCTION public.plate_push_die_layout();

CREATE TRIGGER die_push_plate_layout
  AFTER UPDATE OF around_ups, around_gap, across_ups, across_gap ON public.dies
  FOR EACH ROW EXECUTE FUNCTION public.die_push_plate_layout();
