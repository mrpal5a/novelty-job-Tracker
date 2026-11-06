-- ============================================================
-- 089_activity_log.sql
-- One record of every data change in the app, for Admin's Activity Log page:
-- who added, changed or deleted what, with the old and new values.
--
-- A row-level trigger does the recording, so API routes, database functions
-- and the dashboard's SQL editor are all covered without touching a route.
--
-- Who did it: API routes mostly write with the service role, so auth.uid()
-- is empty. The middleware verifies the session and sets x-actor-id, and
-- createAdminClient forwards it to PostgREST. That header is only believed
-- on a service-role call; anyone else calling PostgREST directly could send
-- whatever they like, so for them the signed JWT decides. No actor means the
-- change came from no signed-in person (cron, SQL editor): the page says System.
--
-- Not recorded, on purpose:
--   messages, conversations, conversation_participants, note_reads:
--     team chat stays private to its participants, Admin included (086).
--   job_status_logs, job_stage_timestamps, print_run_stage_logs,
--   shade_card_status_history, prepress_todo_logs, on_time_dispatch_log:
--     histories written as a side effect of a change recorded here already.
--   data_versions, job_card_counters, job_separation_counters,
--   push_subscriptions: plumbing.
-- Keep the list below in step with src/lib/activityLog.ts (a test checks it).
--
-- Read through the API route with the service role; RLS on, no policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Copied, with no foreign key: a record must outlive the login and the
  -- row it describes.
  actor_id    UUID,
  actor_name  TEXT,
  actor_dept  TEXT,

  table_name  TEXT NOT NULL,
  row_id      TEXT,
  action      TEXT NOT NULL CHECK (action IN ('added', 'changed', 'deleted')),
  label       TEXT,          -- what a person calls the row: "OCT26-14 · 4500123"
  changes     JSONB NOT NULL -- { "status": ["IN USE", "DAMAGE"] }: [old, new]
);

CREATE INDEX IF NOT EXISTS idx_activity_log_table      ON activity_log (table_name, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_actor      ON activity_log (actor_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_changed_at ON activity_log (changed_at);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON activity_log FROM anon, authenticated;

-- The trigger's arguments are the columns that name the row, in order.
-- SECURITY DEFINER: it must write the log and read auth.users whichever role
-- made the change.
CREATE OR REPLACE FUNCTION log_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_row    JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  new_row    JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  this_row   JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  claims     JSONB;
  v_changes  JSONB;
  v_actor    UUID;
  v_name     TEXT;
  v_dept     TEXT;
  v_label    TEXT;
  v_owner    TEXT;
BEGIN
  -- Bookkeeping columns move on every save and say nothing about the change.
  SELECT jsonb_object_agg(key, jsonb_build_array(COALESCE(o.value, 'null'::jsonb), COALESCE(n.value, 'null'::jsonb)))
    INTO v_changes
    FROM jsonb_each(old_row) o
    FULL JOIN jsonb_each(new_row) n USING (key)
   WHERE key <> ALL (ARRAY['id', 'created_at', 'updated_at', 'updated_by', 'updated_by_name', 'po_norm', 'pm_norm', 'name_key'])
     AND COALESCE(o.value, 'null'::jsonb) IS DISTINCT FROM COALESCE(n.value, 'null'::jsonb);

  IF v_changes IS NULL THEN
    RETURN NULL;
  END IF;

  claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  IF claims ->> 'role' = 'service_role' THEN
    v_actor := (NULLIF(current_setting('request.headers', true), '')::jsonb ->> 'x-actor-id')::uuid;
  ELSE
    v_actor := (claims ->> 'sub')::uuid;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT COALESCE(raw_app_meta_data ->> 'username', raw_app_meta_data ->> 'name', email),
           raw_app_meta_data ->> 'department'
      INTO v_name, v_dept
      FROM auth.users
     WHERE id = v_actor;
  END IF;

  SELECT string_agg(NULLIF(this_row ->> col, ''), ' · ' ORDER BY ord)
    INTO v_label
    FROM unnest(TG_ARGV) WITH ORDINALITY AS args(col, ord);

  -- The permission tables hold only a department id and the permission.
  IF this_row ? 'department_id' THEN
    SELECT display_name INTO v_owner FROM departments WHERE id = (this_row ->> 'department_id')::uuid;
    v_label := concat_ws(' · ', v_owner, v_label);
  END IF;

  INSERT INTO activity_log (actor_id, actor_name, actor_dept, table_name, row_id, action, label, changes)
  VALUES (
    v_actor, v_name, v_dept, TG_TABLE_NAME, this_row ->> 'id',
    CASE TG_OP WHEN 'INSERT' THEN 'added' WHEN 'UPDATE' THEN 'changed' ELSE 'deleted' END,
    v_label, v_changes
  );

  -- ponytail: a delete on every write; the changed_at index makes it a no-op
  -- almost always. Same trim-on-write idea as 029. Not left to the daily cron,
  -- so the 12-month limit holds whether or not the cron runs.
  DELETE FROM activity_log WHERE changed_at < now() - INTERVAL '12 months';

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A log entry is never worth refusing someone's real save over.
  RAISE WARNING 'activity log skipped % on %: %', TG_OP, TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION log_activity() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  entry TEXT[];
  args  TEXT;
BEGIN
  FOREACH entry SLICE 1 IN ARRAY ARRAY[
    -- table                              naming columns (blank = none)
    ['job_separations',                   'sr_no',            'po_no',        'pm_code'],
    ['jobs',                              'job_card_number',  'po_number',    'job_name'],
    ['print_runs',                        'run_number',       '',             ''],
    ['stage_comments',                    'stage',            '',             ''],
    ['job_status_requests',               '',                 '',             ''],
    ['machines',                          'name',             '',             ''],
    ['machine_queue_items',               'status',           '',             ''],
    ['printing_units',                    'name',             '',             ''],
    ['plates',                            'plate_id',         'pm_code',      ''],
    ['dies',                              'serial_no',        'job_name',     ''],
    ['flatbed_dies',                      'serial_no',        '',             ''],
    ['cylinders',                         'serial_no',        '',             ''],
    ['shade_cards',                       'shade_card_number','pm_code',      'party'],
    ['label_stock',                       'job_card_number',  'pm_code',      'job_name'],
    ['paper_rolls',                       'ref',              '',             ''],
    ['paper_stock_movements',             'kind',             '',             ''],
    ['pending_dispatch_notifications',    'po_number',        'pm_code',      'party'],
    ['dispatch_schedules',                'release_number',   '',             ''],
    ['party_contacts',                    'party',            'contact_name', ''],
    ['parties',                           'name',             '',             ''],
    ['internal_notification_recipients',  'label',            'email',        ''],
    ['bom_materials',                     'name',             '',             ''],
    ['bom_costings',                      'material_width_mm','',             ''],
    ['bom_material_requests',             'ref',              'material_name',''],
    ['bom_material_orders',               'ref',              'material_name',''],
    ['register_accounts',                 'name',             '',             ''],
    ['register_deals',                    'title',            '',             ''],
    ['register_activities',               'type',             '',             ''],
    ['prepress_todos',                    'task',             '',             ''],
    ['departments',                       'display_name',     '',             ''],
    ['department_feature_permissions',    'feature_key',      '',             ''],
    ['department_stage_permissions',      'stage',            '',             ''],
    ['department_run_stage_permissions',  'run_stage',        '',             ''],
    ['company_settings',                  'company_name',     '',             '']
  ] LOOP
    SELECT COALESCE(string_agg(quote_literal(col), ', '), '')
      INTO args
      FROM unnest(entry[2:4]) AS col
     WHERE col <> '';

    EXECUTE format('DROP TRIGGER IF EXISTS log_activity ON %I', entry[1]);
    EXECUTE format(
      'CREATE TRIGGER log_activity AFTER INSERT OR UPDATE OR DELETE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION log_activity(%s)', entry[1], args);
  END LOOP;
END $$;
