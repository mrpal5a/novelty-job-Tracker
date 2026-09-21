-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 008: dies, plates, flatbed_dies
-- ============================================================
-- The die/plate library — physical tooling reused across reprints.
-- Nothing else in the schema references these tables; a record is
-- corrected or deleted outright rather than soft-removed.
--
-- Consolidates original 019 (dies) + 021 (die status/damage columns),
-- 020 (plates, unchanged since), 035 (flatbed_dies) + 036 (dropped
-- status/damage in favor of an auto serial number) + 049 (repeat_length).
-- ============================================================


-- ============================================================
-- TABLE: dies — rotary dies (cylinder-mounted).
-- ============================================================
CREATE TABLE dies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Column order mirrors the source sheet Prepress has always kept by
  -- hand, so a row here reads the same way.
  job_name          TEXT NOT NULL,
  length            TEXT,          -- free text: the sheet mixes units
  width             TEXT,          -- often a combined "H x W" reading
  cylinder          INTEGER,
  material          TEXT,
  ups               INTEGER,       -- labels per revolution
  gap               TEXT,          -- e.g. "5 MM"
  corner            TEXT,          -- e.g. "SPECIAL", "ROUND"

  -- Etched on the die. Nullable: a die can be logged before its serial
  -- is known, but two dies must never claim the same one.
  serial_no         TEXT,

  die_received_on   DATE,

  -- Where a die is and what state it is in (originally 021).
  -- 'IN USE'  — the default, nothing wrong with it.
  -- 'EXTRA'   — a spare beyond what's mounted.
  -- 'DAMAGE'  — taken out of rotation; damage_date/reason travel with it,
  --             enforced together by the API rather than a CHECK.
  location          TEXT,
  status            TEXT NOT NULL DEFAULT 'IN USE'
                       CHECK (status IN ('IN USE', 'EXTRA', 'DAMAGE')),
  damage_date       DATE,
  damage_reason     TEXT,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The list is the hot path: newest first, filtered by search.
CREATE INDEX idx_dies_created ON dies (created_at DESC);

-- Partial, so any number of dies may sit without a serial while the ones
-- that have a serial stay unique on it. Case-insensitive: hand-typed from
-- the spreadsheet, and 'BNK26-04-39215' / 'bnk26-04-39215' are the same
-- physical die, not two.
CREATE UNIQUE INDEX idx_dies_serial_no
  ON dies (lower(serial_no))
  WHERE serial_no IS NOT NULL;

CREATE TRIGGER touch_dies
  BEFORE UPDATE ON dies
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE dies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dies_select_authenticated"
  ON dies FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================
-- TABLE: plates — printing plates mounted on press cylinders.
-- ============================================================
CREATE TABLE plates (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  party             TEXT NOT NULL,
  pm_code           TEXT,
  item_name         TEXT,
  across_size       TEXT,          -- ACROSS SIZE (H)
  around_size       TEXT,          -- AROUND SIZE (W)
  cylinder          INTEGER,
  plate_id          TEXT,          -- serial etched on the plate
  plate_date        DATE,
  label_per_round   INTEGER,
  location          TEXT,          -- rack / shelf / bay

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plates_created ON plates (created_at DESC);

-- One row per etched serial. Partial + case-insensitive, same reasoning
-- as dies.serial_no.
CREATE UNIQUE INDEX idx_plates_plate_id
  ON plates (lower(plate_id))
  WHERE plate_id IS NOT NULL;

CREATE TRIGGER touch_plates
  BEFORE UPDATE ON plates
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE plates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plates_select_authenticated"
  ON plates FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================
-- TABLE: flatbed_dies — the shop's second physical die type. No
-- cylinder (it doesn't rotate), but it does have a shape, so this gets
-- its own table rather than more nullable columns on `dies`.
--
-- Status/damage tracking was tried (mirroring dies) and then dropped in
-- favor of a plain auto-incrementing serial number — the team decided
-- against status tracking for flatbed dies specifically.
-- ============================================================
CREATE TABLE flatbed_dies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  length            TEXT,          -- free text: the sheet mixes units
  width             TEXT,          -- often a combined "H x W" reading
  ups               INTEGER,       -- labels per sheet/stroke
  gap               TEXT,          -- e.g. "5 MM"
  corner            TEXT,          -- corner radius, e.g. "3 MM", "SPECIAL"
  shape             TEXT,          -- e.g. "RECTANGLE", "OVAL"
  location          TEXT,
  repeat_length     TEXT,          -- repeat distance of the die's pattern

  die_received_on   DATE,

  -- Auto-incrementing, assigned by the database on insert.
  serial_no         INTEGER GENERATED ALWAYS AS IDENTITY,

  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT flatbed_dies_serial_no_unique UNIQUE (serial_no)
);

CREATE INDEX idx_flatbed_dies_created ON flatbed_dies (created_at DESC);

CREATE TRIGGER touch_flatbed_dies
  BEFORE UPDATE ON flatbed_dies
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE flatbed_dies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "flatbed_dies_select_authenticated"
  ON flatbed_dies FOR SELECT
  TO authenticated
  USING (true);
