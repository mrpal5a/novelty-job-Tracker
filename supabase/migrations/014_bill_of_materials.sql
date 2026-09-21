-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 014: Bill of Material — costing model
-- ============================================================
-- The BOM feature shipped twice in the original history: first as a
-- free-form requisition form (migrations 031 bom_requests/
-- bom_request_items, 032 bom_materials, 047 required_quantity), then
-- replaced entirely by an order-versus-material costing comparison
-- (migration 058), which dropped bom_requests/bom_request_items outright
-- and reshaped bom_materials. Since this is a fresh database, only the
-- FINAL shape is created here — the requisition tables never exist.
--
-- The question the owner actually asks of a new PO is "is this order
-- worth taking?" — the answer is the order value from Job Separation
-- next to what the raw material for it will cost. So the BOM is Job
-- Separation's rows again, each with three costing inputs the floor
-- fills in (material from a master list, material width in mm, running
-- metres), and a computed expense and difference beside the order value.
--
-- Three tables:
--   bom_materials          — the master list, carrying ₹ per square metre.
--   bom_costings            — one row per Job Separation row: the three
--                             inputs. Expense is NOT stored — it is
--                             derived from the material's *current* rate,
--                             so a rate correction reprices every job.
--   bom_material_requests   — "Request" pressed on a costed row. Snapshots
--                             the material, metres, width, rate, expense
--                             and order value as they were when asked,
--                             plus the floor's message, and carries the
--                             owner's answer.
--
-- Visibility: bom_use to read every BOM table (matches original 040),
-- enforced by RLS below and again by canDeptUseBOM in every /api/bom-*
-- route. Writes go through the service-role client, gated in the API
-- layer (bom_use to cost a row and raise a request; bom_decide to answer
-- one or edit the master).
-- ============================================================

-- Human-facing reference (BOM-0001) — the thing the floor and the owner
-- say out loud. Separate from the UUID so it stays short and ordered.
CREATE SEQUENCE bom_request_ref_seq;


-- ============================================================
-- TABLE: bom_materials — the material catalogue behind the BOM
-- typeahead. Fills itself: the costing API adds any material name it
-- has not seen before, so the catalogue grows out of real usage instead
-- of needing to be curated up front. name_key is the case- and
-- whitespace-insensitive identity, so "CHROMO 80GSM" and "chromo 80gsm"
-- collapse to one row.
-- ============================================================
CREATE TABLE bom_materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What gets shown and written onto new lines: the first spelling that
  -- entered the catalogue wins, and later near-matches fold into it.
  name          TEXT NOT NULL,

  -- Identity for deduplication. Generated so it can never drift from name.
  name_key      TEXT GENERATED ALWAYS AS (lower(btrim(name))) STORED,

  specification TEXT,

  -- ₹ per square metre. 0 means "rate not entered yet": the costing UI
  -- lists such a material but will not price a job with it — a ₹0
  -- expense would read as a perfect margin, the one wrong answer this
  -- screen must never give.
  rate_per_sqm  NUMERIC(12,4) NOT NULL DEFAULT 0
                  CHECK (rate_per_sqm >= 0),
  -- Retired materials stay on the list (old costings still point at
  -- them) but drop out of the dropdown for new entries.
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by    TEXT,

  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT bom_materials_name_key_unique UNIQUE (name_key)
);

-- The typeahead's query: prefix and substring match on the display name.
CREATE INDEX idx_bom_materials_name_key ON bom_materials (name_key);

CREATE TRIGGER touch_bom_materials
  BEFORE UPDATE ON bom_materials
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE bom_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bom_materials_select_prod_admin"
  ON bom_materials FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));


-- ============================================================
-- TABLE: bom_costings — 1:1 with Job Separation.
-- ============================================================
CREATE TABLE bom_costings (
  -- The PK *is* the FK: a job has one costing, and it goes when the job
  -- separation row does.
  job_separation_id  UUID PRIMARY KEY REFERENCES job_separations(id) ON DELETE CASCADE,

  -- RESTRICT, not SET NULL: a material somebody has already costed a job
  -- with must be retired (is_active = false), never deleted out from
  -- under that job. The API refuses the delete with a clear message.
  material_id        UUID REFERENCES bom_materials(id) ON DELETE RESTRICT,
  material_width_mm  NUMERIC(10,2) CHECK (material_width_mm IS NULL OR material_width_mm > 0),
  running_meter      NUMERIC(12,2) CHECK (running_meter     IS NULL OR running_meter     > 0),

  updated_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bom_costings_material ON bom_costings (material_id);

CREATE TRIGGER touch_bom_costings
  BEFORE UPDATE ON bom_costings
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE bom_costings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bom_costings_select_bom_use"
  ON bom_costings FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));


-- ============================================================
-- TABLE: bom_material_requests — "Request" pressed on a costed row.
-- ============================================================
CREATE TABLE bom_material_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing reference (BOM-0042) — what gets said out loud.
  ref                TEXT NOT NULL UNIQUE
                       DEFAULT ('BOM-' || LPAD(nextval('bom_request_ref_seq')::TEXT, 4, '0')),

  job_separation_id  UUID NOT NULL REFERENCES job_separations(id) ON DELETE CASCADE,

  -- What was asked for, frozen at the moment of asking. The costing row
  -- can be edited again afterwards and the master rate can change; the
  -- request the owner read and acted on must not shift underneath them.
  material_id        UUID REFERENCES bom_materials(id) ON DELETE SET NULL,
  material_name      TEXT NOT NULL,
  material_width_mm  NUMERIC(10,2) NOT NULL,
  running_meter      NUMERIC(12,2) NOT NULL,
  rate_per_sqm       NUMERIC(12,4) NOT NULL,
  expense            NUMERIC(14,2) NOT NULL,
  order_value        NUMERIC(14,2),

  -- The floor's one line to the owner ("stock is short, need by Friday").
  message            TEXT,

  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'ordered', 'declined', 'cancelled')),
  decision_note      TEXT,
  decided_at         TIMESTAMPTZ,
  decided_by         TEXT,

  requested_by_department TEXT NOT NULL,
  requested_by       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The inbox's default query is "pending, newest first"; the nav badge
-- counts pending. The costing table looks up the latest request per job.
CREATE INDEX idx_bom_material_requests_status_created
  ON bom_material_requests (status, created_at DESC);
CREATE INDEX idx_bom_material_requests_job_created
  ON bom_material_requests (job_separation_id, created_at DESC);

CREATE TRIGGER touch_bom_material_requests
  BEFORE UPDATE ON bom_material_requests
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE bom_material_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bom_material_requests_select_bom_use"
  ON bom_material_requests FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));
