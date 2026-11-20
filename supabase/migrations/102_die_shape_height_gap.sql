-- ============================================================
-- 102_die_shape_height_gap.sql
-- Roto dies: "Gap across" (dies.gap, free text) duplicated the height gap
-- (dies.across_gap, migration 101), so the form drops it for an optional
-- Shape, as flatbed dies have. Decided 2026-11-20.
--
-- The old numeric gaps move into the height gap where none is set yet;
-- 'N/A' / 'NA' entries are left behind. dies.gap itself stays as it was,
-- unread by the app, so nothing typed off the sheet is lost.
-- A die's height gap reaches its linked plates (trigger from 101).
-- ============================================================

ALTER TABLE public.dies ADD COLUMN shape TEXT;

UPDATE public.dies
   SET across_gap = gap::numeric
 WHERE across_gap IS NULL
   AND gap ~ '^\s*[0-9]+(\.[0-9]+)?\s*$';

COMMENT ON COLUMN public.dies.gap IS
  'Retired 2026-11-20 (migration 102): the old free-text "Gap across". Numeric values were copied to across_gap; the app no longer reads or writes this column.';
