-- ============================================================
-- 064_bom_material_orders.sql
-- What Admin actually ordered, separate from what was requested.
-- ============================================================
-- Production requests what a job needs (2,000 m). Admin rarely buys that:
-- small orders cost more per metre and in delivery, so the real purchase
-- is bigger (10,000 m). Until now "Order" only flipped the request's
-- status, so the purchased quantity was never recorded and receiving had
-- to guess it.
--
-- bom_material_orders is the purchase: one material, one width, the
-- metres ordered, and the requests it answers (bom_material_requests.
-- order_id). Receiving an order enters rolls for what actually arrived —
-- pre-filled with the ordered metres, correctable for a short or over
-- delivery — and ALL of it goes to stock. The requesting jobs then take
-- their share with "Use" on the costing sheet like any other stock.
--
-- Requests ordered before this migration have no order_id and keep the
-- old per-request Receive path.
-- ============================================================

CREATE SEQUENCE bom_order_ref_seq;

CREATE TABLE bom_material_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ORD-0001 — not "PO", which already means the customer's PO here.
  ref             TEXT NOT NULL UNIQUE
                    DEFAULT ('ORD-' || LPAD(nextval('bom_order_ref_seq')::TEXT, 4, '0')),

  material_id     UUID REFERENCES bom_materials(id) ON DELETE SET NULL,
  material_name   TEXT NOT NULL,                  -- snapshot, like requests
  width_mm        NUMERIC(10,2) NOT NULL CHECK (width_mm > 0),
  ordered_meter   NUMERIC(12,2) NOT NULL CHECK (ordered_meter > 0),

  status          TEXT NOT NULL DEFAULT 'ordered'
                    CHECK (status IN ('ordered', 'received', 'cancelled')),
  received_meter  NUMERIC(12,2) CHECK (received_meter IS NULL OR received_meter > 0),
  received_at     TIMESTAMPTZ,
  received_by     TEXT,

  ordered_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bom_material_orders_status_created ON bom_material_orders (status, created_at DESC);
CREATE INDEX idx_bom_material_orders_material ON bom_material_orders (material_id);

CREATE TRIGGER touch_bom_material_orders
  BEFORE UPDATE ON bom_material_orders
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE bom_material_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bom_material_orders_select_bom_use"
  ON bom_material_orders FOR SELECT TO authenticated
  USING (dept_has_permission('bom_use'));

ALTER TABLE bom_material_requests
  ADD COLUMN order_id UUID REFERENCES bom_material_orders(id) ON DELETE SET NULL;
CREATE INDEX idx_bom_material_requests_order ON bom_material_requests (order_id);

-- The rolls an order became, so Inventory can say where a roll came from.
ALTER TABLE paper_rolls
  ADD COLUMN source_order_id UUID REFERENCES bom_material_orders(id) ON DELETE SET NULL;
CREATE INDEX idx_paper_rolls_source_order ON paper_rolls (source_order_id);


-- ============================================================
-- place_material_order — one purchase answering one or more awaiting
-- requests for the same material and width. Returns the order id.
-- ============================================================
CREATE OR REPLACE FUNCTION place_material_order(
  p_request_ids   UUID[],
  p_ordered_meter NUMERIC,
  p_by            TEXT
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order    UUID;
  v_count    INT;
  v_pending  INT;
  v_keys     INT;
  v_material UUID;
  v_name     TEXT;
  v_width    NUMERIC;
BEGIN
  IF p_ordered_meter IS NULL OR p_ordered_meter <= 0 THEN
    RAISE EXCEPTION 'Metres ordered must be above 0' USING ERRCODE = '22023';
  END IF;
  IF p_request_ids IS NULL OR array_length(p_request_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Pick at least one request to order' USING ERRCODE = '22023';
  END IF;

  -- Lock the requests so two people can't order the same one twice.
  PERFORM 1 FROM bom_material_requests WHERE id = ANY(p_request_ids) FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE status = 'pending'),
         count(DISTINCT (COALESCE(material_id::text, lower(btrim(material_name))), material_width_mm)),
         (array_agg(material_id))[1], (array_agg(material_name))[1], (array_agg(material_width_mm))[1]
    INTO v_count, v_pending, v_keys, v_material, v_name, v_width
    FROM bom_material_requests
   WHERE id = ANY(p_request_ids);

  IF v_count <> array_length(p_request_ids, 1) THEN
    RAISE EXCEPTION 'One of these requests no longer exists — refresh and try again' USING ERRCODE = 'P0001';
  END IF;
  IF v_pending <> v_count THEN
    RAISE EXCEPTION 'One of these requests has already been answered — refresh and try again' USING ERRCODE = 'P0001';
  END IF;
  IF v_keys <> 1 THEN
    RAISE EXCEPTION 'One order covers one material at one width' USING ERRCODE = '22023';
  END IF;

  INSERT INTO bom_material_orders (material_id, material_name, width_mm, ordered_meter, ordered_by)
  VALUES (v_material, v_name, v_width, p_ordered_meter, p_by)
  RETURNING id INTO v_order;

  UPDATE bom_material_requests
     SET status = 'ordered', order_id = v_order, decided_at = NOW(), decided_by = p_by
   WHERE id = ANY(p_request_ids);

  RETURN v_order;
END;
$$;


-- ============================================================
-- receive_material_order — the delivery arrived: enter it as rolls (all
-- of it to stock) and mark the order and its requests received.
-- ============================================================
CREATE OR REPLACE FUNCTION receive_material_order(
  p_order_id        UUID,
  p_roll_count      INTEGER,
  p_meters_per_roll NUMERIC,
  p_location        TEXT,
  p_note            TEXT,
  p_by              TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o        RECORD;
  v_total  NUMERIC;
  v_ids    UUID[];
BEGIN
  SELECT * INTO o FROM bom_material_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'ordered' THEN
    RAISE EXCEPTION '% is already %', o.ref, o.status USING ERRCODE = 'P0001';
  END IF;
  IF o.material_id IS NULL THEN
    RAISE EXCEPTION 'The material on % was deleted from the master — add it back first', o.ref USING ERRCODE = 'P0001';
  END IF;
  IF p_meters_per_roll IS NULL OR p_meters_per_roll <= 0 THEN
    RAISE EXCEPTION 'Metres per roll must be above 0' USING ERRCODE = '22023';
  END IF;

  -- receive_paper_rolls hands back the new roll ids; tag each with the
  -- order. Collected first, in their own statement: an UPDATE can't see
  -- rows a function inserts during that same UPDATE.
  SELECT array_agg(id) INTO v_ids
    FROM receive_paper_rolls(o.material_id, o.width_mm, p_roll_count, p_meters_per_roll,
                             p_location, NULL, COALESCE(p_note, o.ref), NULL, p_by) AS id;
  UPDATE paper_rolls SET source_order_id = o.id WHERE id = ANY(v_ids);

  v_total := round(p_roll_count * p_meters_per_roll, 2);

  UPDATE bom_material_orders
     SET status = 'received', received_meter = v_total, received_at = NOW(), received_by = p_by
   WHERE id = o.id;
  UPDATE bom_material_requests
     SET received_at = COALESCE(received_at, NOW())
   WHERE order_id = o.id;

  RETURN v_total;
END;
$$;


-- ============================================================
-- cancel_material_order — undo an order placed by mistake: the requests
-- go back to Awaiting. Only while nothing has been received.
-- ============================================================
CREATE OR REPLACE FUNCTION cancel_material_order(
  p_order_id UUID,
  p_by       TEXT
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  o RECORD;
BEGIN
  SELECT * INTO o FROM bom_material_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF o.status <> 'ordered' THEN
    RAISE EXCEPTION '% is already % — it can''t be cancelled', o.ref, o.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE bom_material_requests
     SET status = 'pending', order_id = NULL, decided_at = NULL, decided_by = NULL
   WHERE order_id = o.id;
  UPDATE bom_material_orders SET status = 'cancelled' WHERE id = o.id;
END;
$$;

REVOKE ALL ON FUNCTION place_material_order(UUID[], NUMERIC, TEXT)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION receive_material_order(UUID, INTEGER, NUMERIC, TEXT, TEXT, TEXT)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION cancel_material_order(UUID, TEXT)                                   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_material_order(UUID[], NUMERIC, TEXT)                      TO service_role;
GRANT EXECUTE ON FUNCTION receive_material_order(UUID, INTEGER, NUMERIC, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cancel_material_order(UUID, TEXT)                                TO service_role;
