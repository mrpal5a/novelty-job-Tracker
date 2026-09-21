-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 012: party_contacts
-- ============================================================
-- One or more contact records per party (client company). Keyed on
-- `party` TEXT to match jobs.party — intentionally no FK so contacts can
-- be entered before any job exists.
--
-- Column naming note: `contact_name` is the person's name used in
-- email/WhatsApp greetings. The notification routes query this column by
-- name (email/route.ts, whatsapp/route.ts) — do NOT rename to
-- party_name, that would silently break both routes.
--
-- Consolidates original 002 (table, originally one row per party via
-- UNIQUE(party)) + 046 (dropped that uniqueness so a party can have
-- several contacts cc'd on every dispatch — the individual-name greeting
-- is only used when a party has exactly one contact, falling back to the
-- party/company name otherwise) + 040 (RLS rewritten onto
-- dept_has_permission('party_contacts_manage')).
-- ============================================================

CREATE TABLE party_contacts (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  party         TEXT    NOT NULL,        -- matches jobs.party (case-sensitive); not unique — see above
  contact_name  TEXT,                    -- person's name for greeting: "Dear Rajesh Singh"
  email         TEXT,                    -- used by Resend for email notifications
  whatsapp      TEXT,                    -- WATI format: country code + number, no + or spaces
                                          -- e.g. 919876543210 for +91 98765 43210
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary lookup pattern: WHERE party = $1
CREATE INDEX idx_party_contacts_party ON party_contacts (party);

CREATE TRIGGER set_party_contacts_updated_at
  BEFORE UPDATE ON party_contacts
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
--   SELECT → all authenticated users (notification routes run server-side)
--   INSERT / UPDATE / DELETE → gated on 'party_contacts_manage'
--     (Admin-only today via is_super_admin; independently grantable later)
-- ============================================================

ALTER TABLE party_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read party contacts"
  ON party_contacts FOR SELECT
  TO authenticated
  USING (TRUE);

CREATE POLICY "Admin can insert party contacts"
  ON party_contacts FOR INSERT
  TO authenticated
  WITH CHECK (dept_has_permission('party_contacts_manage'));

CREATE POLICY "Admin can update party contacts"
  ON party_contacts FOR UPDATE
  TO authenticated
  USING (dept_has_permission('party_contacts_manage'));

CREATE POLICY "Admin can delete party contacts"
  ON party_contacts FOR DELETE
  TO authenticated
  USING (dept_has_permission('party_contacts_manage'));
