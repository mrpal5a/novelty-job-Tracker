// src/app/api/team/[id]/route.ts
// ============================================================
// PATCH  /api/team/[id] — set a login's username, or set a new password. Admin only.
// DELETE /api/team/[id] — remove a team member's login. Admin only.
//
// Three ways this can go wrong that no confirmation button alone protects
// against, all rejected here regardless of what the client sends:
//   - an Admin removing their own account out from under themselves
//   - removing the last Admin account, locking everyone out of this page
//   - one Admin removing another on a stray click — Admin accounts have
//     full access, so removing one requires the acting Admin to re-enter
//     their own password, not just a second click
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageTeam } from '@/lib/constants/departments';
import { usernameOf } from '@/lib/username';
import { checkUsername } from '@/lib/teamDirectory';
import { deptKeyOf, appMetaOf } from '@/lib/identity';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageTeam(perms)) {
    return NextResponse.json({ error: 'Only Admin can manage the team' }, { status: 403 });
  }

  if (id === user.id) {
    return NextResponse.json({ error: "You can't remove your own account" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target, error: lookupError } = await admin.auth.admin.getUserById(id);
  if (lookupError || !target?.user) return memberLookupFailed(lookupError);

  const targetPerms = await getDeptPermissions(deptKeyOf(target.user));
  if (targetPerms?.isSuperAdmin) {
    const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listError) return NextResponse.json({ error: listError.message }, { status: 500 });

    const memberPerms = await Promise.all(
      list.users.map((u) => getDeptPermissions(deptKeyOf(u)))
    );
    const superAdminCount = memberPerms.filter((p) => p?.isSuperAdmin).length;

    if (superAdminCount <= 1) {
      return NextResponse.json(
        { error: 'At least one Admin account must remain' },
        { status: 400 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const denied = await verifyActingPassword(user.id, body.password);
    if (denied) return denied;
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// A lookup can fail because the login really isn't there (404) or because
// Supabase couldn't be reached — the latter must not read "not found".
function memberLookupFailed(error: { status?: number } | null): NextResponse {
  if (!error || error.status === 404) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }
  console.error('[team/[id]] member lookup failed:', error);
  return NextResponse.json({ error: 'Couldn’t reach the account service — try again' }, { status: 502 });
}

// Re-enter-your-password check for the acting Admin. Compared against the
// stored hash in the database (migration 094), not by signing in again:
// with CAPTCHA on, a server-side sign-in has no token and is always refused.
// ponytail: no attempt limit — only reachable with a live Admin session;
// add a per-user counter if that ever stops being enough.
async function verifyActingPassword(userId: string, password: unknown): Promise<NextResponse | null> {
  if (typeof password !== 'string' || !password) {
    return NextResponse.json({ error: 'Enter your password to confirm' }, { status: 400 });
  }
  const { data, error } = await createAdminClient()
    .rpc('verify_user_password', { p_user_id: userId, p_password: password });
  if (error) {
    console.error('[team/[id]] password check failed:', error);
    return NextResponse.json({ error: 'Couldn’t check your password — try again' }, { status: 502 });
  }
  if (data !== true) return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
  return null;
}

// ── PATCH ─────────────────────────────────────────────────────
// { username?: string, new_password?: string, password?: string }
// A new password for an Admin login — or for your own — also needs the
// acting Admin's own password, the same bar as removing an Admin.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!canDeptManageTeam(perms)) {
    return NextResponse.json({ error: 'Only Admin can manage the team' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();

  const { data: target, error: lookupError } = await admin.auth.admin.getUserById(id);
  if (lookupError || !target?.user) return memberLookupFailed(lookupError);

  const update: { password?: string; app_metadata?: Record<string, unknown> } = {};

  if ('username' in body) {
    const checked = await checkUsername(body.username, id);
    if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    // Spread what's there — department lives in the same metadata.
    // app_metadata, which only the server can write (migration 076).
    update.app_metadata = { ...target.user.app_metadata, username: checked.username };
  }

  if (body.new_password !== undefined) {
    const next = typeof body.new_password === 'string' ? body.new_password : '';
    if (next.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    const targetPerms = await getDeptPermissions(deptKeyOf(target.user));
    if (targetPerms?.isSuperAdmin || id === user.id) {
      const denied = await verifyActingPassword(user.id, body.password);
      if (denied) return denied;
    }
    update.password = next;
  }

  if (!update.password && !update.app_metadata) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }

  const { data, error } = await admin.auth.admin.updateUserById(id, update);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // A new password must end the old one's sign-ins everywhere — that's
  // usually why it was reset. The Admin's own current sign-in is kept.
  if (update.password) {
    const { error: revokeError } = await admin.rpc('revoke_user_sessions', {
      p_user_id: id,
      p_keep_session_id: id === user.id ? user.sessionId ?? null : null,
    });
    if (revokeError) {
      console.error('[team/[id]] session revoke failed:', revokeError);
      return NextResponse.json(
        { error: 'Password changed, but their existing sign-ins could not be ended — try again' },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ member: { id, username: usernameOf(appMetaOf(data.user), data.user.email) } });
}
