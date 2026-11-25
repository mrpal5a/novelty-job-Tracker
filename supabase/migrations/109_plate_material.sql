-- ============================================================
-- 109_plate_material.sql
-- The paper material a plate prints on, spelt as on the roto dies. Every die
-- of the plate's size and cylinder is offered; those cut for this material
-- come first.
--
-- DEPLOY ORDER: apply BEFORE deploying the code (purely additive).
-- ============================================================

ALTER TABLE public.plates ADD COLUMN material TEXT;
