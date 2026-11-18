-- ============================================================
-- 100_job_separation_search_words.sql
-- Job Separation's search_text (098) reshaped to the form 099 gives the
-- other lists: each run of anything but letters and digits becomes one
-- space instead of nothing, so words stay apart and "r4" no longer finds
-- "SUPER 456CS". See 099 for how the app matches it.
--
-- DEPLOY ORDER: apply AFTER the code from 099 is live. That code matches
-- both the old squashed form and this one; the code before it only the
-- squashed form.
-- ============================================================

-- In place (Postgres 17): the table is rewritten and its index rebuilt.
ALTER TABLE public.job_separations
  ALTER COLUMN search_text SET EXPRESSION AS (
    '|' || btrim(regexp_replace(lower(coalesce(sr_no, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(party, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(po_no, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),           '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(material_name, '')),     '[^a-z0-9]+', ' ', 'g'))
 || '|'
  );

COMMENT ON COLUMN public.job_separations.search_text IS
  'Sr No, party, PO, PM code, material: lowercased, other characters as one space, fenced by |. The "All fields" search (099).';

