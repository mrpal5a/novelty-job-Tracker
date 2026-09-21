-- ============================================================
-- LABEL PRINTING JOB TRACKING SYSTEM
-- Migration 002: departments + permission system
-- ============================================================
-- Configurable-departments redesign (originally shipped as migrations
-- 039 + 040, plus incremental feature-permission seed rows added by
-- 041/050/052/053/055 as new features shipped). Departments used to be a
-- hardcoded set of literals scattered across RLS policies
-- (current_dept() = 'Admin', IN ('Dispatch','Admin'), etc). This makes
-- departments data — a row per department, plus which stages/features/
-- run-stages each one may touch — read by the app and by every RLS
-- policy that isn't a bare current_dept() check (those remaining bare
-- checks are documented where they occur, in later files).
--
-- dept_is_super_admin() is used only for the handful of bare "only the
-- one true super-admin" gates that were never a named, independently
-- grantable feature (hard-deleting jobs/timestamps/print runs, deleting
-- departments themselves). Everything that maps to a named feature_key
-- uses dept_has_permission(), so it stays independently grantable to any
-- future department through an admin UI.
-- ============================================================

CREATE TABLE departments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   TEXT UNIQUE NOT NULL,
  display_name          TEXT NOT NULL,
  client_facing_name    TEXT,
  is_protected          BOOLEAN NOT NULL DEFAULT FALSE,
  is_super_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  is_read_only          BOOLEAN NOT NULL DEFAULT FALSE,
  all_stages            BOOLEAN NOT NULL DEFAULT FALSE,
  printing_method_scope TEXT CHECK (printing_method_scope IN ('Offset', 'Flexo')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE department_feature_permissions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  feature_key   TEXT NOT NULL,
  PRIMARY KEY (department_id, feature_key)
);

CREATE TABLE department_stage_permissions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  PRIMARY KEY (department_id, stage)
);

CREATE TABLE department_run_stage_permissions (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  run_stage     TEXT NOT NULL,
  PRIMARY KEY (department_id, run_stage)
);

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_feature_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_stage_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_run_stage_permissions ENABLE ROW LEVEL SECURITY;

-- Every authenticated user needs to read these (every request resolves its
-- own department's permissions).
CREATE POLICY "Authenticated users can read departments"
  ON departments FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated users can read feature permissions"
  ON department_feature_permissions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated users can read stage permissions"
  ON department_stage_permissions FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated users can read run-stage permissions"
  ON department_run_stage_permissions FOR SELECT TO authenticated USING (TRUE);


-- ============================================================
-- Permission-check helper functions
-- ============================================================
CREATE OR REPLACE FUNCTION dept_is_super_admin() RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT is_super_admin FROM departments WHERE key = current_dept()),
    FALSE
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION dept_has_permission(p_feature_key TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM departments d
    WHERE d.key = current_dept()
      AND (
        d.is_super_admin
        OR EXISTS (
          SELECT 1 FROM department_feature_permissions p
          WHERE p.department_id = d.id AND p.feature_key = p_feature_key
        )
      )
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;


-- ============================================================
-- Write policies for the department tables themselves. Only the
-- super-admin department may create/rename/delete departments or edit
-- their permission grids.
-- ============================================================
CREATE POLICY "Super admin can insert departments"
  ON departments FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can update departments"
  ON departments FOR UPDATE TO authenticated
  USING (dept_is_super_admin());
CREATE POLICY "Super admin can delete departments"
  ON departments FOR DELETE TO authenticated
  USING (dept_is_super_admin() AND NOT is_protected);

CREATE POLICY "Super admin can insert feature permissions"
  ON department_feature_permissions FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can delete feature permissions"
  ON department_feature_permissions FOR DELETE TO authenticated
  USING (dept_is_super_admin());

CREATE POLICY "Super admin can insert stage permissions"
  ON department_stage_permissions FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can delete stage permissions"
  ON department_stage_permissions FOR DELETE TO authenticated
  USING (dept_is_super_admin());

CREATE POLICY "Super admin can insert run-stage permissions"
  ON department_run_stage_permissions FOR INSERT TO authenticated
  WITH CHECK (dept_is_super_admin());
CREATE POLICY "Super admin can delete run-stage permissions"
  ON department_run_stage_permissions FOR DELETE TO authenticated
  USING (dept_is_super_admin());


-- ============================================================
-- Seed: departments
-- ============================================================
INSERT INTO departments (key, display_name, client_facing_name, is_protected, is_super_admin, is_read_only, all_stages, printing_method_scope) VALUES
  ('Prepress',   'Prepress Team',    NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('QC',         'QC Team',          NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Production', 'Production Team',  NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Postpress',  'Postpress Team',   NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Dispatch',   'Dispatch Team',    NULL,                    FALSE, FALSE, FALSE, FALSE, NULL),
  ('Admin',      'Admin',            'Admin Team',            TRUE,  TRUE,  FALSE, TRUE,  NULL),
  ('Viewer',     'Viewer (read-only)', NULL,                  TRUE,  FALSE, TRUE,  FALSE, NULL);

-- ============================================================
-- Seed: department_feature_permissions — final state after every
-- feature-permission seed added across the original history (039, 041
-- prepress_todo_manage, 050 meter_calculator_use, 052 box_slip_print,
-- 053 roll_slip_print, 055 shade_card_manage). Admin needs no rows —
-- is_super_admin grants every feature_key implicitly.
-- ============================================================
INSERT INTO department_feature_permissions (department_id, feature_key)
SELECT id, feature_key FROM departments, (VALUES
  ('Prepress',   'printing_edit'),
  ('Production', 'printing_edit'),
  ('Prepress',   'job_detail_edit'),
  ('Dispatch',   'stock_edit'),
  ('Dispatch',   'dispatch_notifications'),
  ('Prepress',   'dies_plates_edit'),
  ('Prepress',   'job_separation_edit'),
  ('Production', 'bom_use'),
  ('Dispatch',   'delivery_date_edit'),
  ('Postpress',  'slitting_confirm'),
  ('Production', 'print_run_manage'),
  ('Production', 'machine_board_manage'),
  ('Prepress',   'prepress_todo_manage'),
  ('Prepress',   'meter_calculator_use'),
  ('Dispatch',   'box_slip_print'),
  ('Dispatch',   'roll_slip_print'),
  ('Prepress',   'shade_card_manage'),
  ('QC',         'shade_card_manage')
) AS grants(dept_key, feature_key)
WHERE departments.key = grants.dept_key;

-- ============================================================
-- Seed: department_stage_permissions
-- Admin uses all_stages=TRUE instead (set above); Viewer gets no rows.
-- ============================================================
INSERT INTO department_stage_permissions (department_id, stage)
SELECT id, stage FROM departments, (VALUES
  ('Prepress',   'PO Received'),
  ('Prepress',   'Artwork Pending'),
  ('Prepress',   'Plate Status'),
  ('Prepress',   'Job Card Done'),
  ('QC',         'Sample Printing'),
  ('QC',         'Shade Card Sent'),
  ('QC',         'Shade Card Approved'),
  ('QC',         'Quality Check'),
  ('Production', 'In Printing'),
  ('Production', 'On Hold'),
  ('Postpress',  'Slitting'),
  ('Postpress',  'On Hold'),
  ('Dispatch',   'Packing'),
  ('Dispatch',   'Ready to Dispatch'),
  ('Dispatch',   'Partial Dispatch'),
  ('Dispatch',   'Dispatched')
) AS grants(dept_key, stage)
WHERE departments.key = grants.dept_key;

-- ============================================================
-- Seed: department_run_stage_permissions
-- Admin gets every run stage implicitly via is_super_admin.
-- ============================================================
INSERT INTO department_run_stage_permissions (department_id, run_stage)
SELECT id, run_stage FROM departments, (VALUES
  ('Production', 'Printing'),
  ('Postpress',  'Slitting'),
  ('QC',         'QC'),
  ('Dispatch',   'Packing'),
  ('Dispatch',   'Ready to Dispatch'),
  ('Dispatch',   'Dispatched')
) AS grants(dept_key, run_stage)
WHERE departments.key = grants.dept_key;
