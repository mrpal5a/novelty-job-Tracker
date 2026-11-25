-- ============================================================
-- 112_plate_direction_and_form.sql
-- The way a plate's labels unwind, and whether they are supplied as rolls or
-- sheets, so its job cards fill both boxes themselves. Blank on every plate
-- until someone picks them, on the plate or on its next job card.
--
-- DEPLOY ORDER: apply BEFORE deploying the code (purely additive).
-- ============================================================

ALTER TABLE public.plates
  ADD COLUMN direction  TEXT CHECK (direction IN ('UNWIND#1', 'UNWIND#2', 'UNWIND#3', 'UNWIND#4')),
  ADD COLUMN roll_sheet TEXT CHECK (roll_sheet IN ('ROLL', 'SHEET'));
