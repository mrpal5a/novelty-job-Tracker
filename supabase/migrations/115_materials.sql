-- ============================================================
-- Migration 115: materials — Prepress's material list
-- ============================================================
-- The list every Material field picks from (plates, roto dies, job cards),
-- so a material is spelt one way across the app. Kept apart from
-- bom_materials on purpose: BOM's list is the costing master with a rate on
-- every row; this one is names only, and Prepress owns it.
--
-- plates/dies/job_cards.material stay free TEXT: removing a name here only
-- changes what the dropdown offers, never a record already saved with it
-- (the same rule as parties).
-- ============================================================

CREATE TABLE materials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (btrim(name) <> ''),
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "PP WHITE", "pp white " are one material.
CREATE UNIQUE INDEX idx_materials_name_lower ON materials (lower(btrim(name)));

ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

-- Everyone reads (every Material field); writes go through the service-role
-- client in /api/materials, gated to Prepress/Admin (job_separation_edit).
CREATE POLICY "materials_select_authenticated"
  ON materials FOR SELECT TO authenticated USING (true);

CREATE TRIGGER log_activity AFTER INSERT OR UPDATE OR DELETE ON materials
  FOR EACH ROW EXECUTE FUNCTION log_activity('name');

-- Start from the names already on plates, dies and job cards, so saved
-- records still match; Prepress removes the near-duplicates.
INSERT INTO materials (name, created_by)
SELECT DISTINCT ON (lower(btrim(m))) btrim(m), 'migration 115'
FROM (
  SELECT material AS m FROM plates
  UNION ALL SELECT material FROM dies
  UNION ALL SELECT material FROM job_cards
) s
WHERE btrim(coalesce(m, '')) <> ''
ORDER BY lower(btrim(m)), btrim(m)
ON CONFLICT DO NOTHING;
