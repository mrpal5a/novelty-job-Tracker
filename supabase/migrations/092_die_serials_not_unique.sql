-- ============================================================
-- 092_die_serials_not_unique.sql
-- A die serial is the die maker's order number, and one order can carry
-- several dies (different sizes for one job, or a mounted die plus its
-- spare). The legacy ROTO Die.xlsx has 155 serials shared across rows, so
-- one-die-per-serial (008) doesn't hold. Same reasoning as 091 for plates.
-- ============================================================

DROP INDEX IF EXISTS idx_dies_serial_no;
