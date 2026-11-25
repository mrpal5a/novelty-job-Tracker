-- ============================================================
-- 110_plate_artworks.sql
-- The artwork printed in the space on a job card. The picture is a file in
-- the private "artwork" bucket, shrunk to print size (200 dpi); this table
-- only says where it is, so the database and its weekly backup stay small.
--
-- It belongs to the plate, so a repeat order finds it already attached. The
-- newest row of a plate is its artwork; an issued card keeps the id of the
-- one it was issued with (details.artwork).
--
-- Files go 90 days after their last use (src/lib/artwork.ts): removed_at is
-- set and the row stays, so the card can say when. Files are only ever
-- deleted through the Storage API: deleting storage rows here would leave
-- the file behind.
--
-- No policies on purpose: read and written by the API (service role) only.
-- DEPLOY ORDER: apply BEFORE deploying the code (purely additive).
-- ============================================================

CREATE TABLE public.plate_artworks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_id     UUID REFERENCES public.plates(id) ON DELETE SET NULL,
  path         TEXT NOT NULL UNIQUE,             -- in the artwork bucket
  file_name    TEXT NOT NULL,                    -- as chosen by the person
  width        INTEGER NOT NULL CHECK (width  BETWEEN 1 AND 6000),
  height       INTEGER NOT NULL CHECK (height BETWEEN 1 AND 6000),
  bytes        INTEGER NOT NULL CHECK (bytes  > 0),
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- attached, opened or issued
  removed_at   TIMESTAMPTZ                          -- file deleted
);

CREATE INDEX idx_plate_artworks_plate ON public.plate_artworks (plate_id, created_at DESC);
-- The daily clean-up's question.
CREATE INDEX idx_plate_artworks_stored ON public.plate_artworks (last_used_at) WHERE removed_at IS NULL;

ALTER TABLE public.plate_artworks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.plate_artworks FROM anon, authenticated;

-- Attaching only: last_used_at moves every time a card is opened.
CREATE TRIGGER log_activity
  AFTER INSERT ON public.plate_artworks
  FOR EACH ROW EXECUTE FUNCTION public.log_activity('file_name');

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('artwork', 'artwork', false, 2097152, ARRAY['image/webp', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;
