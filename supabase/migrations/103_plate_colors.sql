-- ============================================================
-- 103_plate_colors.sql
-- The colours a plate set prints, in station order: one entry per colour,
-- as many as plates.total_colors (1–12). The form starts the first four
-- as CYAN, MAGENTA, YELLOW, BLACK; the rest are typed (spot colours,
-- white, varnish…). A blank entry is NULL. Feeds the job card.
-- ============================================================

ALTER TABLE public.plates
  ADD COLUMN colors TEXT[]
    CHECK (colors IS NULL OR cardinality(colors) BETWEEN 1 AND 12);
