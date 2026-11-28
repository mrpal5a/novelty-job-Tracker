-- ============================================================
-- Migration 116: Production asks for an edit
-- ============================================================
-- Production, instead of accepting an issued card, can send it back with a
-- note: { note, by, at }. Prepress sees it on the card and in the lists until
-- the card is issued again (the API clears it then) or accepted (cleared in
-- the same update, so the 113 lock never sees it change on an accepted card).
-- The Activity Log keeps every note.
--
-- DEPLOY ORDER: apply BEFORE deploying the code (purely additive).
-- ============================================================

ALTER TABLE public.job_cards
  ADD COLUMN edit_request JSONB,
  ADD CONSTRAINT job_cards_edit_request_ok CHECK (
    edit_request IS NULL
    OR (accepted_at IS NULL AND jsonb_typeof(edit_request->'note') = 'string' AND length(edit_request->>'note') BETWEEN 1 AND 1000)
  );
