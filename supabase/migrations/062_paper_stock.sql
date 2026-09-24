-- ============================================================
-- 062_paper_stock.sql
-- Paper (raw material) roll inventory, linked to Bill of Material.
-- ============================================================
-- Production asked for one thing: when they pick a material and width on
-- the BOM costing sheet, show what is already on the shelf — "5 rolls,
-- 10,000 m of BMB1450 at 110 mm" — so they use stock when it's there and
-- only raise a Request when it isn't.
--
-- Stock is tracked PER ROLL, not as a running total per material+width.
-- A roll is the physical thing on the rack, and paper is consumed a job
-- at a time, so half-used rolls are the normal state of the store. A
-- total alone can't say "4 full + 1 part roll of 650 m", which is exactly
-- what the floor needs to know before they walk to the rack.
--
--   paper_rolls             — one row per physical roll: material (from
--                             the BOM master), width, original length,
--                             what's left, where it sits.
--   paper_stock_movements   — the ledger. Every metre in or out, with the
--                             job it went to. remaining_meter on the roll
--                             is the running balance; this is the "why".
--
-- Every change that touches both tables goes through one of the SQL
-- functions below, so a roll's balance and its ledger can never drift
-- apart, and two people issuing from the same rolls at once serialise on
-- the row locks instead of both spending the same metres.
--
-- Visibility: bom_use reads (the stock lives inside the BOM section).
-- Writes use the service-role client, gated in the API layer:
--   paper_stock_manage — receive, adjust, delete rolls (Admin + Production)
--   bom_use            — issue stock to a job / return it
-- ============================================================

CREATE SEQUENCE paper_roll_ref_seq;

-- ============================================================
-- TABLE: paper_rolls
-- ============================================================
CREATE TABLE paper_rolls (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short roll number to write on the core with a marker: R-0042.
  ref               TEXT NOT NULL UNIQUE
                      DEFAULT ('R-' || LPAD(nextval('paper_roll_ref_seq')::TEXT, 4, '0')),

  -- RESTRICT: a material with rolls on the shelf can be retired but not
  -- deleted out from under them.
  material_id       UUID NOT NULL REFERENCES bom_materials(id) ON DELETE RESTRICT,
  width_mm          NUMERIC(10,2) NOT NULL CHECK (width_mm > 0),

  initial_meter     NUMERIC(12,2) NOT NULL CHECK (initial_meter > 0),
  remaining_meter   NUMERIC(12,2) NOT NULL,

  location          TEXT,   -- rack / bay
  supplier          TEXT,
  note              TEXT,

  -- Set when the roll came in against a BOM request ("Receive into stock").
  source_request_id UUID REFERENCES bom_material_requests(id) ON DELETE SET NULL,

  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT paper_rolls_remaining_range
    CHECK (remaining_meter >= 0 AND remaining_meter <= initial_meter)
);

-- The BOM lookup and the inventory grouping: live rolls by material+width.
CREATE INDEX idx_paper_rolls_material_width_live
  ON paper_rolls (material_id, width_mm)
  WHERE remaining_meter > 0;
CREATE INDEX idx_paper_rolls_material ON paper_rolls (material_id);
CREATE INDEX idx_paper_rolls_source_request ON paper_rolls (source_request_id);

CREATE TRIGGER touch_paper_rolls
  BEFORE UPDATE ON paper_rolls
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE paper_rolls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_rolls_select_bom_use"
  ON paper_rolls FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));


-- ============================================================
-- TABLE: paper_stock_movements — the ledger
-- ============================================================
CREATE TABLE paper_stock_movements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roll_id            UUID NOT NULL REFERENCES paper_rolls(id) ON DELETE CASCADE,

  --   receive — roll entered stock (+initial)
  --   issue   — metres taken for a job (−)
  --   return  — issued metres put back (+)
  --   adjust  — physical count / damage / write-off correction (±)
  kind               TEXT NOT NULL CHECK (kind IN ('receive', 'issue', 'return', 'adjust')),
  meters             NUMERIC(12,2) NOT NULL CHECK (meters <> 0),

  -- SET NULL: the ledger outlives the job row it served.
  job_separation_id  UUID REFERENCES job_separations(id) ON DELETE SET NULL,

  note               TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_paper_stock_movements_roll_created
  ON paper_stock_movements (roll_id, created_at DESC);
CREATE INDEX idx_paper_stock_movements_job
  ON paper_stock_movements (job_separation_id)
  WHERE job_separation_id IS NOT NULL;

ALTER TABLE paper_stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paper_stock_movements_select_bom_use"
  ON paper_stock_movements FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));


-- ============================================================
-- bom_material_requests.received_at — when the ordered paper arrived and
-- was entered as rolls. Not a new status: 'ordered' still means ordered,
-- this just says the order has landed.
-- ============================================================
ALTER TABLE bom_material_requests ADD COLUMN received_at TIMESTAMPTZ;


-- ============================================================
-- FUNCTION: receive_paper_rolls — N identical rolls into stock at once
-- ("5 rolls × 2000 m"). Returns the new roll ids.
-- ============================================================
CREATE OR REPLACE FUNCTION receive_paper_rolls(
  p_material_id       UUID,
  p_width_mm          NUMERIC,
  p_roll_count        INTEGER,
  p_meters_per_roll   NUMERIC,
  p_location          TEXT,
  p_supplier          TEXT,
  p_note              TEXT,
  p_source_request_id UUID,
  p_by                TEXT
) RETURNS SETOF UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_roll_count IS NULL OR p_roll_count < 1 OR p_roll_count > 500 THEN
    RAISE EXCEPTION 'Number of rolls must be between 1 and 500' USING ERRCODE = '22023';
  END IF;

  FOR i IN 1..p_roll_count LOOP
    INSERT INTO paper_rolls (material_id, width_mm, initial_meter, remaining_meter,
                             location, supplier, note, source_request_id, created_by)
    VALUES (p_material_id, p_width_mm, p_meters_per_roll, p_meters_per_roll,
            p_location, p_supplier, p_note, p_source_request_id, p_by)
    RETURNING id INTO v_id;

    INSERT INTO paper_stock_movements (roll_id, kind, meters, note, created_by)
    VALUES (v_id, 'receive', p_meters_per_roll, p_note, p_by);

    RETURN NEXT v_id;
  END LOOP;

  IF p_source_request_id IS NOT NULL THEN
    UPDATE bom_material_requests
       SET received_at = COALESCE(received_at, NOW())
     WHERE id = p_source_request_id;
  END IF;
END;
$$;


-- ============================================================
-- FUNCTION: issue_paper_stock — take metres of one material+width for a
-- job. Part-used rolls go first (smallest first — finish the stubs before
-- opening a fresh roll, which is how the floor actually works), then full
-- rolls oldest first. All-or-nothing: if the shelf is short, nothing is
-- taken and the error says how much there is.
-- ============================================================
CREATE OR REPLACE FUNCTION issue_paper_stock(
  p_material_id       UUID,
  p_width_mm          NUMERIC,
  p_meters            NUMERIC,
  p_job_separation_id UUID,
  p_note              TEXT,
  p_by                TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_left  NUMERIC := p_meters;
  v_take  NUMERIC;
BEGIN
  IF p_meters IS NULL OR p_meters <= 0 THEN
    RAISE EXCEPTION 'Metres to issue must be above 0' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT id, remaining_meter
      FROM paper_rolls
     WHERE material_id = p_material_id
       AND width_mm = p_width_mm
       AND remaining_meter > 0
     ORDER BY (remaining_meter < initial_meter) DESC, remaining_meter ASC, received_at ASC
       FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, r.remaining_meter);

    UPDATE paper_rolls SET remaining_meter = remaining_meter - v_take WHERE id = r.id;
    INSERT INTO paper_stock_movements (roll_id, kind, meters, job_separation_id, note, created_by)
    VALUES (r.id, 'issue', -v_take, p_job_separation_id, p_note, p_by);

    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'Only % m in stock for this material and width', (p_meters - v_left)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN p_meters;
END;
$$;


-- ============================================================
-- FUNCTION: return_paper_stock_for_job — undo every issue for a job,
-- putting each roll's metres back on the roll they came from. Returns the
-- total metres returned (0 if nothing was out).
-- ============================================================
CREATE OR REPLACE FUNCTION return_paper_stock_for_job(
  p_job_separation_id UUID,
  p_by                TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r       RECORD;
  v_total NUMERIC := 0;
  v_back  NUMERIC;
BEGIN
  FOR r IN
    SELECT m.roll_id, -SUM(m.meters) AS net_out
      FROM paper_stock_movements m
     WHERE m.job_separation_id = p_job_separation_id
       AND m.kind IN ('issue', 'return')
     GROUP BY m.roll_id
    HAVING -SUM(m.meters) > 0
  LOOP
    -- Lock the roll, then put the metres back. LEAST guards a roll that was
    -- adjusted since: it can't end up longer than it started.
    SELECT LEAST(initial_meter - remaining_meter, r.net_out) INTO v_back
      FROM paper_rolls WHERE id = r.roll_id FOR UPDATE;
    IF v_back IS NULL OR v_back <= 0 THEN CONTINUE; END IF;

    UPDATE paper_rolls SET remaining_meter = remaining_meter + v_back WHERE id = r.roll_id;
    INSERT INTO paper_stock_movements (roll_id, kind, meters, job_separation_id, created_by)
    VALUES (r.roll_id, 'return', v_back, p_job_separation_id, p_by);
    v_total := v_total + v_back;
  END LOOP;

  RETURN v_total;
END;
$$;


-- ============================================================
-- FUNCTION: adjust_paper_roll — set a roll's remaining metres to what's
-- physically there (recount, damage, write-off to 0), logging the delta.
-- ============================================================
CREATE OR REPLACE FUNCTION adjust_paper_roll(
  p_roll_id   UUID,
  p_remaining NUMERIC,
  p_note      TEXT,
  p_by        TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_before  NUMERIC;
  v_initial NUMERIC;
BEGIN
  SELECT remaining_meter, initial_meter INTO v_before, v_initial
    FROM paper_rolls WHERE id = p_roll_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roll not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_remaining IS NULL OR p_remaining < 0 OR p_remaining > v_initial THEN
    RAISE EXCEPTION 'Remaining metres must be between 0 and % m', v_initial USING ERRCODE = '22023';
  END IF;

  IF p_remaining <> v_before THEN
    UPDATE paper_rolls SET remaining_meter = p_remaining WHERE id = p_roll_id;
    INSERT INTO paper_stock_movements (roll_id, kind, meters, note, created_by)
    VALUES (p_roll_id, 'adjust', p_remaining - v_before, p_note, p_by);
  END IF;

  RETURN p_remaining;
END;
$$;

-- Service role only: the API layer is where department permission lives.
REVOKE ALL ON FUNCTION receive_paper_rolls(UUID, NUMERIC, INTEGER, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION issue_paper_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, TEXT)                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION return_paper_stock_for_job(UUID, TEXT)                                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION adjust_paper_roll(UUID, NUMERIC, TEXT, TEXT)                                       FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION receive_paper_rolls(UUID, NUMERIC, INTEGER, NUMERIC, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION issue_paper_stock(UUID, NUMERIC, NUMERIC, UUID, TEXT, TEXT)                        TO service_role;
GRANT EXECUTE ON FUNCTION return_paper_stock_for_job(UUID, TEXT)                                             TO service_role;
GRANT EXECUTE ON FUNCTION adjust_paper_roll(UUID, NUMERIC, TEXT, TEXT)                                       TO service_role;


-- ============================================================
-- Permission: paper_stock_manage — Production by default (Admin has
-- every feature implicitly as super-admin).
-- ============================================================
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, 'paper_stock_manage' FROM departments WHERE key = 'Production'
ON CONFLICT DO NOTHING;
