-- ============================================================
-- 098_job_separation_search_text.sql
-- One forgiving search column for Job Separation lines.
--
-- "All fields" used to look for the typed text, exactly as typed, inside
-- each of five columns. So "upl 03" missed party "UPL - 03", "pm203232"
-- missed "PM-203232", and "riverline 2032" (party + PM code) found nothing
-- because no single column holds both.
--
-- search_text holds the five key fields lowercased with only letters and
-- digits kept, joined and fenced by "|":
--   |aug261|upl03|5000485|203232|marinepollutant10x10cm|
-- The app squashes typed text the same way (squashAscii in src/lib/search.ts)
-- and matches it as a phrase inside one field, or word by word across
-- fields; "|<text>|" is a field that IS the text, which it lists first.
-- One trigram index serves all of it, in place of five column searches.
--
-- Also: the activity log skips search_text, as it already skips po_norm —
-- it changes with the fields it is made from and says nothing of its own.
--
-- DEPLOY ORDER: apply BEFORE deploying the code that reads search_text
-- (purely additive, safe with the old code).
-- ============================================================

ALTER TABLE public.job_separations
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    '|' || lower(regexp_replace(coalesce(sr_no, ''),         '[^A-Za-z0-9]', '', 'g'))
 || '|' || lower(regexp_replace(coalesce(party, ''),         '[^A-Za-z0-9]', '', 'g'))
 || '|' || lower(regexp_replace(coalesce(po_no, ''),         '[^A-Za-z0-9]', '', 'g'))
 || '|' || lower(regexp_replace(coalesce(pm_code, ''),       '[^A-Za-z0-9]', '', 'g'))
 || '|' || lower(regexp_replace(coalesce(material_name, ''), '[^A-Za-z0-9]', '', 'g'))
 || '|'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_job_separations_search_text_trgm
  ON public.job_separations USING gin (search_text gin_trgm_ops);

COMMENT ON COLUMN public.job_separations.search_text IS
  'Sr No, party, PO, PM code, material: lowercased, letters and digits only, fenced by |. The "All fields" search (098).';

-- log_activity as live (089), with search_text added to the skipped columns.
CREATE OR REPLACE FUNCTION public.log_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   WHERE key <> ALL (ARRAY['id', 'created_at', 'updated_at', 'updated_by', 'updated_by_name', 'po_norm', 'pm_norm', 'name_key', 'search_text'])
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
$function$;
