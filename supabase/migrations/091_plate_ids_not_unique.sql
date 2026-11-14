-- ============================================================
-- 091_plate_ids_not_unique.sql
-- A plate ID is the plate maker's order number, and one order can carry
-- several items: front + back labels, or two items ganged on one plate.
-- The legacy Plates.xlsx has 86 rows sharing an ID with another item, so
-- one-row-per-ID (008) doesn't hold. Drop the unique index; search on
-- plate_id is a contains-match and never used it.
-- ============================================================

DROP INDEX IF EXISTS idx_plates_plate_id;
