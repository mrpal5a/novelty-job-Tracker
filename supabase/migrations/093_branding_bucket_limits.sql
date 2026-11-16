-- ============================================================
-- 093_branding_bucket_limits.sql
-- The public "branding" bucket (017) had no size or type limit — only
-- POST /api/settings/branding/logo checked them. Enforce the same rules in
-- Storage itself so nothing reaching the bucket another way can skip them.
-- SVG is no longer allowed: a public SVG can carry script, and email
-- clients don't show an SVG logo attachment anyway.
-- ============================================================

UPDATE storage.buckets
SET file_size_limit    = 2097152,  -- 2 MB, matches the route's MAX_BYTES
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
WHERE id = 'branding';
