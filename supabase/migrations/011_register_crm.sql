-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 011: Register — Admin-only customer follow-up CRM
-- ============================================================
-- Accounts, deals (enquiries moving through a 5-stage pipeline), and a
-- follow-up activity log. Admin-only end to end, unlike the rest of the
-- app: RLS restricts SELECT to whoever holds the 'register_manage'
-- feature (Admin has it implicitly via is_super_admin) — this holds
-- customer/sales data with no reason to be shop-floor-visible. Writes
-- still go through the service-role admin client in the API layer, gated
-- by the same permission.
--
-- Consolidates original 027 (tables, originally RLS'd with an inline JWT
-- check) + 040 (RLS rewritten onto dept_has_permission('register_manage')
-- as part of the departments redesign — only the final policy shape is
-- kept here).
-- ============================================================

CREATE TABLE register_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  contact_name  TEXT,
  contact_role  TEXT,
  phone         TEXT,
  email         TEXT,
  segment       TEXT,
  city          TEXT,
  notes         TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE register_deals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES register_accounts(id) ON DELETE CASCADE,
  title              TEXT NOT NULL,
  stage              TEXT NOT NULL DEFAULT 'enquiry'
                       CHECK (stage IN ('enquiry','artwork','quotation','approval','po')),
  owner              TEXT,
  qty                TEXT,
  value              NUMERIC(14,2),
  substrate          TEXT,
  next_action        TEXT,
  next_action_date   DATE,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  lost_reason        TEXT,
  closed_at          DATE,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE register_activities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES register_accounts(id) ON DELETE CASCADE,
  deal_id     UUID REFERENCES register_deals(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  type        TEXT NOT NULL,
  by          TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The Today view's whole job is "what's overdue / due / unscheduled,
-- fastest" — this is the query it runs.
CREATE INDEX idx_register_deals_status_next ON register_deals (status, next_action_date);
CREATE INDEX idx_register_deals_account      ON register_deals (account_id);
CREATE INDEX idx_register_activities_account ON register_activities (account_id);
CREATE INDEX idx_register_activities_deal    ON register_activities (deal_id);
CREATE INDEX idx_register_activities_date    ON register_activities (date DESC);

CREATE TRIGGER touch_register_accounts
  BEFORE UPDATE ON register_accounts
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER touch_register_deals
  BEFORE UPDATE ON register_deals
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();


-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE register_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_deals      ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "register_accounts_select_admin"
  ON register_accounts FOR SELECT TO authenticated
  USING (dept_has_permission('register_manage'));

CREATE POLICY "register_deals_select_admin"
  ON register_deals FOR SELECT TO authenticated
  USING (dept_has_permission('register_manage'));

CREATE POLICY "register_activities_select_admin"
  ON register_activities FOR SELECT TO authenticated
  USING (dept_has_permission('register_manage'));
