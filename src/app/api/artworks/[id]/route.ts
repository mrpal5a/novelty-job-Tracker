// src/app/api/artworks/[id]/route.ts
// ============================================================
// GET /api/artworks/[id] — the picture itself, for an <img>: sends the
// signed-in browser on to a private link that stops working in an hour.
// Opening it counts as using it (its 90 days start again), noted once a day.
// Anyone who can sign in to the admin side can see it, as with issued cards.
// DELETE — take the artwork off its plate (or its card, when it has no plate). Needs job_card_edit. The file goes
// at once, unless an issued card prints it: that card keeps it.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deleteArtworkFiles, splitByIssuedCards } from '@/lib/api/artworkFiles';
import { jobCardWriter } from '@/lib/api/jobCardSources';
import { deptKeyOf } from '@/lib/identity';
import { ARTWORK_BUCKET } from '@/lib/artwork';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const user = await getClaimsUser(await createServerSupabaseClient());
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await getDeptPermissions(deptKeyOf(user)))) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });
  if (!UUID.test(id)) return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });

  const db = createAdminClient();
  const { data, error } = await db.from('plate_artworks').select('path, last_used_at, removed_at').eq('id', id).maybeSingle();
  if (error) {
    console.error('[GET /api/artworks/[id]]', error);
    return NextResponse.json({ error: 'Failed to load the artwork' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });
  if (data.removed_at) return NextResponse.json({ error: 'Artwork removed' }, { status: 410 });

  if (Date.now() - Date.parse(data.last_used_at) > 86_400_000) {
    await db.from('plate_artworks').update({ last_used_at: new Date().toISOString() }).eq('id', id);
  }
  const { data: link, error: linkError } = await db.storage.from(ARTWORK_BUCKET).createSignedUrl(data.path, 3600);
  if (linkError || !link) {
    console.error('[GET /api/artworks/[id]] link', linkError);
    return NextResponse.json({ error: 'Failed to load the artwork' }, { status: 500 });
  }
  // Remembered for ten minutes, so the screen and print copies share one download.
  // Vary: not by someone else, or signed out, on a shared computer.
  return NextResponse.redirect(link.signedUrl, { status: 302, headers: { 'Cache-Control': 'private, max-age=600', Vary: 'Cookie' } });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const writer = await jobCardWriter();
  if ('denied' in writer) return writer.denied;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Artwork not found' }, { status: 404 });

  const db = createAdminClient();
  try {
    const { data: art, error } = await db.from('plate_artworks').select('id, plate_id, job_card_id, removed_at').eq('id', id).maybeSingle();
    if (error) throw error;
    const owner = art?.plate_id ? 'plate_id' : 'job_card_id';
    if (!art || art.removed_at || !art[owner]) return NextResponse.json({ error: 'This artwork is already removed' }, { status: 404 });

    // All of the plate's: an earlier one kept for an issued card mustn't come back.
    const all = await db.from('plate_artworks').select('id, path').eq(owner, art[owner]).is('removed_at', null);
    if (all.error) throw all.error;
    const { shown, free } = await splitByIssuedCards((all.data ?? []) as { id: string; path: string }[]);
    if (shown.length) {
      const { error: detachError } = await db.from('plate_artworks').update({ plate_id: null, job_card_id: null }).in('id', shown.map((a) => a.id));
      if (detachError) throw detachError;
    }
    await deleteArtworkFiles(free);
    return NextResponse.json({ ok: true, keptForIssued: shown.length });
  } catch (e) {
    console.error('[DELETE /api/artworks/[id]]', e);
    return NextResponse.json({ error: 'Failed to remove the artwork' }, { status: 500 });
  }
}
