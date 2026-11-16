-- ============================================================
-- 094_verify_user_password.sql
-- "Re-enter your password" for removing an Admin or resetting an Admin's
-- password (api/team/[id]) used to sign in again to check it. With CAPTCHA
-- on in Supabase Auth, a server-side sign-in has no CAPTCHA token and is
-- always refused, so the check could never pass. This compares the typed
-- password with the stored bcrypt hash instead. Server only: the route
-- calls it with the service role, for the signed-in Admin's own id.
-- ============================================================

CREATE OR REPLACE FUNCTION public.verify_user_password(p_user_id uuid, p_password text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = p_user_id
      AND encrypted_password IS NOT NULL
      AND encrypted_password <> ''
      AND encrypted_password = extensions.crypt(p_password, encrypted_password)
  );
$$;

REVOKE ALL ON FUNCTION public.verify_user_password(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_user_password(uuid, text) TO service_role;
