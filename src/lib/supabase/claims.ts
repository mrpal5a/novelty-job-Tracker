// src/lib/supabase/claims.ts
// Drop-in replacement for `supabase.auth.getUser()`.
//
// getUser() always makes a network round-trip to Supabase's Auth server to
// re-verify the session, on every single call. This project's Supabase
// project has been migrated to asymmetric JWT signing keys (ECC P-256), so
// getClaims() can verify the JWT's signature locally (against a JWKS cached
// in memory per server instance) instead — no network call once the JWKS is
// warm. Same trust guarantee, without the latency, and safe to call as many
// times per request as needed (unlike getUser(), which pays the round-trip
// cost every time).
//
// Identity comes from app_metadata, never user_metadata: the signed-in user
// can rewrite their own user_metadata from the browser, so a department or
// username read from there could be anything they like (migration 076).
// Read the department with deptKeyOf(user) from '@/lib/identity'.
//
// A token issued before migration 076 has no department in app_metadata
// (tokens refresh hourly); for that case only, the same app_metadata is read
// from the server's copy of the account instead.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';

export interface ClaimsUser {
  id: string;
  email: string;
  /** Service-role-only metadata: department and username. Safe to trust. */
  app_metadata: Record<string, unknown>;
  /** The sign-in this token belongs to (auth.sessions.id). */
  sessionId?: string;
}

// A valid signature only proves the token was issued — not that the login
// still exists. Removing a team member or resetting their password deletes
// their sessions (migration 095), so each token's session is looked up too.
// ponytail: a live answer is remembered 60 s per server instance, so a
// revoked login can linger that long; shorten LIVE_TTL_MS if that's too much.
const LIVE_TTL_MS = 60_000;
const liveUntil = new Map<string, number>();

async function sessionIsLive(sessionId: string): Promise<boolean> {
  const now = Date.now();
  if ((liveUntil.get(sessionId) ?? 0) > now) return true;

  const { data, error } = await createAdminClient().rpc('session_is_live', { p_session_id: sessionId });
  if (error) {
    // The signature already checked out; a database hiccup must not sign
    // everyone out. Not cached, so the next request asks again.
    console.error('[claims] session check failed:', error);
    return true;
  }
  if (data !== true) {
    liveUntil.delete(sessionId);
    return false;
  }
  if (liveUntil.size > 1000) liveUntil.clear();
  liveUntil.set(sessionId, now + LIVE_TTL_MS);
  return true;
}

export async function getClaimsUser(
  supabase: SupabaseClient
): Promise<ClaimsUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) return null;

  const { claims } = data;
  const sessionId = typeof claims.session_id === 'string' ? claims.session_id : undefined;
  if (sessionId && !(await sessionIsLive(sessionId))) return null;

  let appMeta = (claims.app_metadata as Record<string, unknown> | undefined) ?? {};

  if (typeof appMeta.department !== 'string') {
    const { data: fresh } = await createAdminClient().auth.admin.getUserById(claims.sub);
    appMeta = (fresh?.user?.app_metadata as Record<string, unknown> | undefined) ?? appMeta;
  }

  return {
    id: claims.sub,
    email: claims.email ?? '',
    app_metadata: appMeta,
    sessionId,
  };
}
