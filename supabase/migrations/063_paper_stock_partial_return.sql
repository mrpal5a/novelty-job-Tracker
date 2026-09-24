-- ============================================================
-- 063_paper_stock_partial_return.sql
-- Return part of what was issued to a job, not all of it.
-- ============================================================
-- The floor issues generously (6,000 m for a 5,000 m job) and brings the
-- leftover back after printing — 500 m on the roll that came off the
-- press. So Return now takes a quantity.
--
-- Where the metres go: back onto the roll this job took from MOST
-- RECENTLY, because that's the roll physically coming back. If the
-- quantity is more than was taken from that roll, the rest goes onto the
-- one before it, and so on. A roll never ends up longer than it started,
-- and a job can never return more than it has out (issued − returned).
--
-- p_meters NULL still means "return everything", which is what 062's
-- function did.
-- ============================================================

DROP FUNCTION IF EXISTS return_paper_stock_for_job(UUID, TEXT);

CREATE OR REPLACE FUNCTION return_paper_stock_for_job(
  p_job_separation_id UUID,
  p_meters            NUMERIC,
  p_note              TEXT,
  p_by                TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  r        RECORD;
  v_out    NUMERIC;
  v_left   NUMERIC;
  v_total  NUMERIC := 0;
  v_room   NUMERIC;
  v_back   NUMERIC;
BEGIN
  SELECT COALESCE(-SUM(meters), 0) INTO v_out
    FROM paper_stock_movements
   WHERE job_separation_id = p_job_separation_id
     AND kind IN ('issue', 'return');

  IF v_out <= 0 THEN
    RAISE EXCEPTION 'Nothing from stock is out on this job' USING ERRCODE = 'P0001';
  END IF;
  IF p_meters IS NOT NULL AND p_meters <= 0 THEN
    RAISE EXCEPTION 'Metres to return must be above 0' USING ERRCODE = '22023';
  END IF;
  IF p_meters IS NOT NULL AND p_meters > v_out THEN
    RAISE EXCEPTION 'Only % m is out on this job — you can''t return more than that', v_out
      USING ERRCODE = 'P0001';
  END IF;

  v_left := COALESCE(p_meters, v_out);

  FOR r IN
    SELECT m.roll_id, -SUM(m.meters) AS net_out, MAX(m.created_at) FILTER (WHERE m.kind = 'issue') AS last_issued
      FROM paper_stock_movements m
     WHERE m.job_separation_id = p_job_separation_id
       AND m.kind IN ('issue', 'return')
     GROUP BY m.roll_id
    HAVING -SUM(m.meters) > 0
     ORDER BY last_issued DESC
  LOOP
    EXIT WHEN v_left <= 0;

    SELECT initial_meter - remaining_meter INTO v_room
      FROM paper_rolls WHERE id = r.roll_id FOR UPDATE;
    v_back := LEAST(v_left, r.net_out, COALESCE(v_room, 0));
    IF v_back <= 0 THEN CONTINUE; END IF;

    UPDATE paper_rolls SET remaining_meter = remaining_meter + v_back WHERE id = r.roll_id;
    INSERT INTO paper_stock_movements (roll_id, kind, meters, job_separation_id, note, created_by)
    VALUES (r.roll_id, 'return', v_back, p_job_separation_id, p_note, p_by);

    v_total := v_total + v_back;
    v_left  := v_left - v_back;
  END LOOP;

  -- Only reachable if the rolls were adjusted down since issuing and have
  -- no room left for these metres. All-or-nothing, like issuing.
  IF p_meters IS NOT NULL AND v_left > 0 THEN
    RAISE EXCEPTION 'The rolls this job used only have room for % m — adjust them in Inventory first', v_total
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION return_paper_stock_for_job(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION return_paper_stock_for_job(UUID, NUMERIC, TEXT, TEXT) TO service_role;


-- ============================================================
-- issue_paper_stock again, with one change: each movement is stamped with
-- clock_timestamp(), not the transaction's NOW(). One issue can take from
-- several rolls, and "the roll taken from last" (the one Return puts the
-- leftover back onto) has to be a real ordering, not a tie.
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
    INSERT INTO paper_stock_movements (roll_id, kind, meters, job_separation_id, note, created_by, created_at)
    VALUES (r.id, 'issue', -v_take, p_job_separation_id, p_note, p_by, clock_timestamp());

    v_left := v_left - v_take;
  END LOOP;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'Only % m in stock for this material and width', (p_meters - v_left)
      USING ERRCODE = 'P0001';
  END IF;

  RETURN p_meters;
END;
$$;
