-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 015: shade_cards + shade_card_status_history
-- ============================================================
-- Folds in the standalone Shade Card Tracker, which ran as its own Next
-- app against its own Supabase project. The pipeline already has
-- "Shade Card Sent" and "Shade Card Approved" stages owned by QC — this
-- brings the actual shade card records alongside them instead of leaving
-- them in a second system nothing links to.
--
-- Consolidates original 055 (tables + trigger) + 056 (fixed the trigger
-- to run SECURITY DEFINER — it was declared to do so in a comment but
-- never actually marked, so every insert/update of shade_cards failed
-- RLS on shade_card_status_history; only the corrected trigger is kept
-- here).
--
-- No `profiles` table: the source app's four roles map onto this app's
-- department permission system exactly (viewer -> Viewer, prepress ->
-- Prepress, qc -> QC, admin -> Admin), so RLS here rides
-- dept_has_permission()/dept_is_super_admin() like every other table.
-- ============================================================


-- ============================================================
-- shade_cards
-- ============================================================
-- A revision supersedes its predecessor rather than overwriting it: the
-- new row carries version+1 and supersedes_id, and the old row drops
-- is_current — that is how the approval trail stays intact.
CREATE TABLE shade_cards (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  party               TEXT NOT NULL,
  product_name        TEXT NOT NULL,

  -- The PM number: the primary key for cross-referencing a card to a
  -- job. Not unique: the same PM code legitimately appears on a
  -- reissued card.
  pm_code             TEXT,
  shade_card_number   TEXT,
  docket_number       TEXT,

  -- Rejected / Revision Requested / Expired were retired at QC's request
  -- and are no longer offered in the UI, but they stay legal here:
  -- historical rows and status-history entries may still carry them.
  status              TEXT NOT NULL DEFAULT 'Pending Approval'
                        CHECK (status IN ('Pending Approval', 'Approved', 'Rejected',
                                          'Revision Requested', 'Expired')),

  -- Whether the physical card has actually been made. One-way in
  -- practice: "Already Made" never goes back to "Pending" (enforced in
  -- the API layer).
  making_status       TEXT NOT NULL DEFAULT 'Pending'
                        CHECK (making_status IN ('Pending', 'Already Made')),

  prepared_date       DATE,
  approval_date       DATE,
  sent_to_party_date  DATE,
  received_back_date  DATE,

  -- A QNAP share path typed in for reference. Never fetched or resolved
  -- by the app — it is a note that happens to look like a path.
  qnap_path           TEXT,
  notes               TEXT,

  version             INTEGER NOT NULL DEFAULT 1,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  supersedes_id       UUID REFERENCES shade_cards(id) ON DELETE SET NULL,

  -- SET NULL rather than CASCADE: a departing employee must not delete
  -- the shade cards they entered. The *_name snapshot outlives the
  -- account.
  created_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_name     TEXT,
  updated_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name     TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every list view filters is_current first, then sorts by updated_at.
CREATE INDEX idx_shade_cards_is_current  ON shade_cards (is_current);
CREATE INDEX idx_shade_cards_status      ON shade_cards (status);
CREATE INDEX idx_shade_cards_making      ON shade_cards (making_status);
CREATE INDEX idx_shade_cards_updated_at  ON shade_cards (updated_at DESC);
CREATE INDEX idx_shade_cards_prepared    ON shade_cards (prepared_date);
CREATE INDEX idx_shade_cards_supersedes  ON shade_cards (supersedes_id);

-- The job cross-reference matches on pm_code first and falls back to
-- party + product_name, case-insensitive on both sides.
CREATE INDEX idx_shade_cards_pm_code     ON shade_cards (LOWER(pm_code));
CREATE INDEX idx_shade_cards_party_prod  ON shade_cards (LOWER(party), LOWER(product_name));

CREATE TRIGGER shade_cards_set_updated_at
  BEFORE UPDATE ON shade_cards
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- shade_card_status_history
-- ============================================================
-- Append-only audit trail, written by trigger rather than by the API so
-- a direct SQL edit is recorded too.
CREATE TABLE shade_card_status_history (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- CASCADE here, unlike the SET NULL above: a history row has no
  -- meaning once its card is gone, and deleting a card is already
  -- super-admin-only.
  shade_card_id    UUID NOT NULL REFERENCES shade_cards(id) ON DELETE CASCADE,

  old_status       TEXT,          -- NULL on the row recording creation
  new_status       TEXT NOT NULL,
  changed_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name  TEXT,
  changed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sc_history_card_id    ON shade_card_status_history (shade_card_id, changed_at DESC);
CREATE INDEX idx_sc_history_changed_at ON shade_card_status_history (changed_at DESC);

-- Records creation and every subsequent status change. Fires on INSERT
-- so a card's trail starts at its first status, and on UPDATE only when
-- status actually moved — a field edit or a making_status flip writes
-- nothing. SECURITY DEFINER so it bypasses RLS on
-- shade_card_status_history (which has no client-facing INSERT policy —
-- the audit trail can only ever be written by this trigger); search_path
-- is pinned so it can't be hijacked by a session-local change.
CREATE OR REPLACE FUNCTION log_shade_card_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO shade_card_status_history
      (shade_card_id, old_status, new_status, changed_by, changed_by_name)
    VALUES (NEW.id, NULL, NEW.status, NEW.created_by, NEW.created_by_name);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO shade_card_status_history
      (shade_card_id, old_status, new_status, changed_by, changed_by_name)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.updated_by, NEW.updated_by_name);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER shade_cards_log_status
  AFTER INSERT OR UPDATE ON shade_cards
  FOR EACH ROW EXECUTE FUNCTION log_shade_card_status();


-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE shade_cards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE shade_card_status_history ENABLE ROW LEVEL SECURITY;

-- Readable by every department. Anyone about to print needs to know
-- whether a shade card exists and whether the party signed it off — same
-- reasoning as plates and dies.
CREATE POLICY "shade_cards_select_authenticated"
  ON shade_cards FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "shade_cards_insert_permitted"
  ON shade_cards FOR INSERT
  TO authenticated
  WITH CHECK (dept_has_permission('shade_card_manage'));

CREATE POLICY "shade_cards_update_permitted"
  ON shade_cards FOR UPDATE
  TO authenticated
  USING (dept_has_permission('shade_card_manage'))
  WITH CHECK (dept_has_permission('shade_card_manage'));

-- Deletion stays with the super-admin department, matching the source
-- app, where delete was admin-only while Prepress and QC could do
-- everything else.
CREATE POLICY "shade_cards_delete_super_admin"
  ON shade_cards FOR DELETE
  TO authenticated
  USING (dept_is_super_admin());

-- History is readable by all and writable by no one: every row arrives
-- through the trigger, which runs as its definer and is not subject to
-- these policies. No INSERT/UPDATE/DELETE policy exists, so the audit
-- trail cannot be rewritten from the client even by an admin.
CREATE POLICY "sc_history_select_authenticated"
  ON shade_card_status_history FOR SELECT
  TO authenticated
  USING (TRUE);


COMMENT ON TABLE shade_cards IS
  'Shade cards sent to parties for colour approval. Originally migrated from the standalone Shade Card Tracker.';
COMMENT ON COLUMN shade_cards.qnap_path IS
  'Reference-only QNAP share path typed in by the user. Never resolved or fetched by the app.';
COMMENT ON COLUMN shade_cards.is_current IS
  'FALSE once a later revision supersedes this row. Every list view filters on TRUE.';
