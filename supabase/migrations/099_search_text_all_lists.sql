-- ============================================================
-- 099_search_text_all_lists.sql
-- The forgiving "All fields" search column (098) on the other searched
-- lists: jobs, plates, shade cards and label stock. 100 reshapes Job
-- Separation's own column to the same form.
--
-- 098 squashed each field to letters and digits only. That let "upl03"
-- find "UPL - 03" — but also glued words together, so "r4" found plates
-- named "SUPER 456CS" ("super456cs"). Now each run of anything but letters
-- and digits becomes ONE space, and fields stay fenced by "|":
--   |aug26 1|upl 03|5000485|203232|marine pollutant 10x10 cm|
-- The app (termFilter in src/lib/search.ts) matches a typed term, squashed,
-- either inside one word (LIKE, as the old search did) or from the start
-- of a word skipping spaces (regex "(^|[ |])u ?p ?l ?0 ?3"). So "upl03",
-- "UPL-03" and "upl 03" still find UPL - 03; "r4" no longer finds SUPER 456.
-- One trigram index per table serves both (gin_trgm_ops covers LIKE and ~).
--
-- The activity log already skips any column named search_text (098).
--
-- DEPLOY ORDER: apply BEFORE deploying the code that reads these columns
-- (purely additive). Then deploy, then apply 100.
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    '|' || btrim(regexp_replace(lower(coalesce(job_card_number, '')),   '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(po_number, '')),         '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(party, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(job_name, '')),          '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),           '[^a-z0-9]+', ' ', 'g'))
 || '|'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_jobs_search_text_trgm
  ON public.jobs USING gin (search_text gin_trgm_ops);

COMMENT ON COLUMN public.jobs.search_text IS
  'Job card, PO, party, job name, PM code: lowercased, other characters as one space, fenced by |. The "All fields" search (099).';

ALTER TABLE public.plates
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    '|' || btrim(regexp_replace(lower(coalesce(party, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),           '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(item_name, '')),         '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(plate_id, '')),          '[^a-z0-9]+', ' ', 'g'))
 || '|'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_plates_search_text_trgm
  ON public.plates USING gin (search_text gin_trgm_ops);

COMMENT ON COLUMN public.plates.search_text IS
  'Party, PM code, item name, plate ID: lowercased, other characters as one space, fenced by |. The "All fields" search (099).';

ALTER TABLE public.shade_cards
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    '|' || btrim(regexp_replace(lower(coalesce(party, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),           '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(product_name, '')),      '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(shade_card_number, '')), '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(docket_number, '')),     '[^a-z0-9]+', ' ', 'g'))
 || '|'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_shade_cards_search_text_trgm
  ON public.shade_cards USING gin (search_text gin_trgm_ops);

COMMENT ON COLUMN public.shade_cards.search_text IS
  'Party, PM code, product, shade card #, docket #: lowercased, other characters as one space, fenced by |. The "All fields" search (099).';

ALTER TABLE public.label_stock
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    '|' || btrim(regexp_replace(lower(coalesce(job_card_number, '')),   '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(po_number, '')),         '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),           '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(party, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(job_name, '')),          '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(location, '')),          '[^a-z0-9]+', ' ', 'g'))
 || '|'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_label_stock_search_text_trgm
  ON public.label_stock USING gin (search_text gin_trgm_ops);

COMMENT ON COLUMN public.label_stock.search_text IS
  'Job card, PO, PM code, party, job name, location: lowercased, other characters as one space, fenced by |. The "All fields" search (099).';
