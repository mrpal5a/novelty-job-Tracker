-- ============================================================
-- 095_session_revocation.sql
-- A login's token is checked from its signature alone (lib/supabase/claims),
-- so a removed team member — or a session an Admin meant to end by resetting
-- a password — kept working until the token ran out (up to an hour).
--   session_is_live       the server asks this per request (cached 60 s):
--                         is the token's session still in auth.sessions?
--                         Removing a login deletes its sessions (cascade).
--   revoke_user_sessions  ends a login's sessions after a password reset,
--                         optionally keeping the one doing the reset.
-- Server only: service role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.session_is_live(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.sessions
    WHERE id = p_session_id AND (not_after IS NULL OR not_after > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_sessions(p_user_id uuid, p_keep_session_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH gone AS (
    DELETE FROM auth.sessions
    WHERE user_id = p_user_id
      AND (p_keep_session_id IS NULL OR id <> p_keep_session_id)
    RETURNING 1
  )
  SELECT count(*)::integer FROM gone;
$$;

REVOKE ALL ON FUNCTION public.session_is_live(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_user_sessions(uuid, uuid)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.session_is_live(uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_user_sessions(uuid, uuid) TO service_role;
