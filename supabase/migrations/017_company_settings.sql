-- LABEL PRINTING JOB TRACKING SYSTEM
-- ============================================================
-- Company branding, self-service. One singleton row (id = 1) holding the
-- name/address/support email/logo that used to be hardcoded, then briefly
-- an env var — now editable from /admin/settings so a company can change
-- its own details without a redeploy.
--
-- RLS is enabled with NO policies: every read/write goes through the
-- service-role client (lib/branding.ts's getBranding(), and the
-- PATCH /api/settings/branding route, both server-only and already
-- gated on dept_is_super_admin() at the application layer), so there is
-- no case where an anon or authenticated client queries this table
-- directly. Default-deny is correct here, not an oversight.
-- ============================================================

CREATE TABLE company_settings (
  id                        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name              TEXT NOT NULL DEFAULT 'Your Print Company',
  company_short_name        TEXT NOT NULL DEFAULT 'Your Print Co',
  company_production_name   TEXT NOT NULL DEFAULT 'YOUR PRINT CO',
  address                   TEXT NOT NULL DEFAULT 'Your City, State, Country',
  support_email             TEXT NOT NULL DEFAULT 'support@example.com',
  return_address            TEXT NOT NULL DEFAULT 'YOUR PRINT CO
Your street address
Your city - PIN
Your state
PHONE - your number',
  logo_url                  TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO company_settings (id) VALUES (1);

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

-- Public logo storage: the logo has to render on the public /track portal
-- and /login, unauthenticated, so it lives in a public bucket. Uploads and
-- deletes are still admin-only, enforced the same way as the table above —
-- at the application layer in the service-role-backed upload route — so no
-- storage.objects policies are needed for authenticated writers either.
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read branding assets"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'branding');
