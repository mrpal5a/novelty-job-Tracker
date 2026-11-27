-- Shade cards: "All fields" search now covers notes too.
-- search_text (099) is a generated column, so it can't be altered in place:
-- drop it and add it back with notes as the last field. Same form as 099 —
-- lowercased, other characters as one space, fields fenced by "|".

DROP INDEX IF EXISTS public.idx_shade_cards_search_text_trgm;
ALTER TABLE public.shade_cards DROP COLUMN IF EXISTS search_text;

ALTER TABLE public.shade_cards
  ADD COLUMN search_text text GENERATED ALWAYS AS (
    '|' || btrim(regexp_replace(lower(coalesce(party, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(pm_code, '')),           '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(product_name, '')),      '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(shade_card_number, '')), '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(docket_number, '')),     '[^a-z0-9]+', ' ', 'g'))
 || '|' || btrim(regexp_replace(lower(coalesce(notes, '')),             '[^a-z0-9]+', ' ', 'g'))
 || '|'
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_shade_cards_search_text_trgm
  ON public.shade_cards USING gin (search_text gin_trgm_ops);

COMMENT ON COLUMN public.shade_cards.search_text IS
  'Party, PM code, product, shade card #, docket #, notes: lowercased, other characters as one space, fenced by |. The "All fields" search (099, notes 114).';
