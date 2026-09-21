-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 009: job_separations + parties
-- ============================================================
-- Job Separation — the Prepress worksheet that splits an incoming PO into
-- individually trackable line items ahead of job-card creation. Only
-- Prepress and Admin enter or correct a row.
--
-- Consolidates original 022 (table + sr_no auto-assignment) + 025
-- (trigram search indexes) + 033 (link to a created Job) + 034 (Cancel
-- action) + 051 (sr_no trigger replaced to file under the PO's own
-- month rather than the entry date — only the final trigger body is
-- kept), plus 023 (parties master list).
-- ============================================================

CREATE TABLE job_separations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auto-assigned by the trigger below, e.g. AUG26-1. Nullable only so an
  -- explicit value (import / manual correction) can be supplied instead.
  sr_no           TEXT,

  party           TEXT NOT NULL,
  po_no           TEXT,
  po_date         DATE,
  pm_code         TEXT,
  material_name   TEXT,
  quantity        INTEGER,
  unit            TEXT,             -- '1' | '2' | '1&2' — which printing unit(s)
  job_status      TEXT,

  rate            NUMERIC(12,2),
  -- Derived, not entered: a generated column can never drift from
  -- quantity × rate the way a hand-typed total could.
  order_value     NUMERIC(14,2) GENERATED ALWAYS AS (
                     CASE WHEN quantity IS NOT NULL AND rate IS NOT NULL
                          THEN quantity * rate END
                  ) STORED,

  jc_status       TEXT,             -- e.g. 'DONE'
  aw_send_to      TEXT,             -- e.g. 'REPEAT' — artwork re-send flag

  -- Lets Prepress/Admin add a Job straight from a row (prefilled from
  -- party/po_no/po_date/pm_code/quantity/material_name). linked_job_id
  -- marks a row as "already turned into a Job" so the button becomes
  -- "View Job" instead of creating a second Job from the same row.
  -- linked_job_card_number is denormalized so the worksheet can display
  -- it without a join.
  linked_job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,
  linked_job_card_number   TEXT,

  -- Cancel replaces hard delete: the row (and its Sr. No.) stays visible
  -- forever, struck through and marked with why. One-way — no un-cancel.
  cancelled_at    TIMESTAMPTZ,
  cancelled_by    TEXT,
  cancel_reason   TEXT,

  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list is the hot path: newest first, filtered by search.
CREATE INDEX idx_job_separations_created ON job_separations (created_at DESC);


-- ============================================================
-- Sr. No. auto-assignment: <MON><YY>-<seq>, e.g. AUG26-1.
-- Own period counter table so this sequence never collides with
-- job_card_counters (004_jobs_core.sql) — see that migration's comments
-- for why an UPSERT counter is used instead of a MAX(seq)+1 read.
--
-- Files under the PO's own month (po_date), not the month the row was
-- entered, so a PO dated 31 Aug added on 1 Sep still gets an AUG26
-- number. Falls back to created_at only when po_date is absent (a
-- safety net for imports/legacy paths — the app requires PO Date on
-- every new row).
-- ============================================================
CREATE TABLE job_separation_counters (
  period    TEXT    PRIMARY KEY,          -- 'AUG26'
  last_seq  INTEGER NOT NULL DEFAULT 0
);

-- STABLE only (not IMMUTABLE): the AT TIME ZONE conversion depends on
-- the timezone database.
CREATE OR REPLACE FUNCTION job_separation_period(ts TIMESTAMPTZ)
RETURNS TEXT AS $$
  SELECT upper(to_char(ts AT TIME ZONE 'Asia/Kolkata', 'MonYY'));
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION trigger_set_job_separation_sr_no()
RETURNS TRIGGER AS $$
DECLARE
  v_period TEXT;
  v_seq    INTEGER;
BEGIN
  -- An explicitly supplied Sr. No. wins, so imports and manual
  -- corrections can pin a specific value without the trigger
  -- overwriting it.
  IF NEW.sr_no IS NOT NULL AND btrim(NEW.sr_no) <> '' THEN
    RETURN NEW;
  END IF;

  -- po_date is a plain DATE — no time-of-day or timezone to resolve — so
  -- its month is read directly instead of routing through
  -- job_separation_period()'s Asia/Kolkata conversion.
  IF NEW.po_date IS NOT NULL THEN
    v_period := upper(to_char(NEW.po_date, 'MonYY'));
  ELSE
    v_period := job_separation_period(COALESCE(NEW.created_at, NOW()));
  END IF;

  INSERT INTO job_separation_counters (period, last_seq)
       VALUES (v_period, 1)
  ON CONFLICT (period)
  DO UPDATE SET last_seq = job_separation_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

  NEW.sr_no := v_period || '-' || v_seq;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_job_separation_sr_no
  BEFORE INSERT ON job_separations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_job_separation_sr_no();

-- Safety net: if the counter is ever bypassed or a Sr. No. hand-edited, a
-- duplicate fails loudly at write time.
CREATE UNIQUE INDEX idx_job_separations_sr_no ON job_separations (sr_no);
CREATE INDEX idx_job_separations_sr_no_lower ON job_separations (lower(sr_no));

CREATE TRIGGER touch_job_separations
  BEFORE UPDATE ON job_separations
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();


-- ============================================================
-- Trigram indexes for the free-text search in GET /api/job-separations
-- (`ilike '%term%'` — a leading wildcard that no btree can serve). One
-- index per searchable column so every field-scoped search benefits.
-- ============================================================
CREATE INDEX idx_job_separations_sr_no_trgm         ON job_separations USING GIN (sr_no gin_trgm_ops);
CREATE INDEX idx_job_separations_party_trgm         ON job_separations USING GIN (party gin_trgm_ops);
CREATE INDEX idx_job_separations_po_no_trgm         ON job_separations USING GIN (po_no gin_trgm_ops);
CREATE INDEX idx_job_separations_pm_code_trgm       ON job_separations USING GIN (pm_code gin_trgm_ops);
CREATE INDEX idx_job_separations_material_name_trgm ON job_separations USING GIN (material_name gin_trgm_ops);
CREATE INDEX idx_job_separations_unit_trgm          ON job_separations USING GIN (unit gin_trgm_ops);
CREATE INDEX idx_job_separations_job_status_trgm    ON job_separations USING GIN (job_status gin_trgm_ops);
CREATE INDEX idx_job_separations_jc_status_trgm     ON job_separations USING GIN (jc_status gin_trgm_ops);
CREATE INDEX idx_job_separations_aw_send_to_trgm    ON job_separations USING GIN (aw_send_to gin_trgm_ops);


-- ── Row Level Security ────────────────────────────────────────
-- Authenticated staff read (every department can search and view live);
-- writes go through the service-role admin client in the API layer,
-- where the Prepress/Admin authorisation lives.
ALTER TABLE job_separations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_separations_select_authenticated"
  ON job_separations FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================
-- TABLE: parties — master list of party (client) names for the Job
-- Separation worksheet typeahead, so "ARYSTA", "Arysta" and "arysta "
-- never end up as three different parties in the data.
--
-- The Party column on job_separations stays free TEXT, unchanged — this
-- table only feeds its typeahead. Deleting a name here never touches a
-- row already saved with it.
-- ============================================================
CREATE TABLE parties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Case-insensitive, trim-insensitive: the same guard dies.serial_no and
-- plates.plate_id use for hand-typed values that must not fork into
-- near-duplicates.
CREATE UNIQUE INDEX idx_parties_name_lower ON parties (lower(btrim(name)));
-- The typeahead's hot path: prefix search, alphabetical.
CREATE INDEX idx_parties_name ON parties (name);

ALTER TABLE parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parties_select_authenticated"
  ON parties FOR SELECT
  TO authenticated
  USING (true);
