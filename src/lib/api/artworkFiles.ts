// src/lib/api/artworkFiles.ts
// Saving and deleting artwork files. Deleting: always the file first, then removed_at: if it stops
// half way, the daily clean-up finishes.

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ARTWORK_BUCKET, ARTWORK_MAX_BYTES, artworkType } from '@/lib/artwork';

type Stored = { id: string; path: string };

export async function deleteArtworkFiles(rows: Stored[]): Promise<void> {
  const db = createAdminClient();
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await db.storage.from(ARTWORK_BUCKET).remove(batch.map((a) => a.path));
    if (error) throw error;
    const marked = await db.from('plate_artworks').update({ removed_at: new Date().toISOString() }).in('id', batch.map((a) => a.id));
    if (marked.error) throw marked.error;
  }
}

/** Those an issued job card prints: they are left for it, and expire by themselves. */
export async function splitByIssuedCards(rows: Stored[]): Promise<{ shown: Stored[]; free: Stored[] }> {
  if (rows.length === 0) return { shown: [], free: [] };
  const { data, error } = await createAdminClient().from('job_cards')
    .select('art:details->artwork->>id').in('details->artwork->>id', rows.map((a) => a.id));
  if (error) throw error;
  const used = new Set((data as { art: string }[] | null ?? []).map((c) => c.art));
  return { shown: rows.filter((a) => used.has(a.id)), free: rows.filter((a) => !used.has(a.id)) };
}

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status });
const fail = (step: string, error: unknown) => {
  console.error('[artwork]', step, error);
  return refuse('Failed to save the artwork', 500);
};
type Owner = { column: 'plate_id' | 'job_card_id'; id: string };

/** Saves the uploaded picture (multipart: file, name, width, height) as its
 *  owner's, replacing what it had; a file an issued card shows is left to expire. */
export async function saveArtwork(request: NextRequest, owner: Owner, by: string): Promise<NextResponse> {
  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!form || !(file instanceof File) || file.size === 0) return refuse('No artwork received', 400);
  if (file.size > ARTWORK_MAX_BYTES) return refuse('Artwork must be under 2 MB', 400);
  const [width, height] = [Number(form.get('width')), Number(form.get('height'))];
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 6000)) return refuse('Artwork size is not valid', 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = artworkType(bytes);
  if (!type) return refuse('Artwork must be WebP or JPEG', 400);

  const db = createAdminClient();
  const found = await db.from(owner.column === 'plate_id' ? 'plates' : 'job_cards').select('id').eq('id', owner.id).maybeSingle();
  if (found.error) return fail('owner', found.error);
  if (!found.data) return refuse(owner.column === 'plate_id' ? 'Plate not found' : 'Job card not found', 404);

  const path = `${owner.id}/${crypto.randomUUID()}.${type.ext}`;
  const store = db.storage.from(ARTWORK_BUCKET);
  const { error: uploadError } = await store.upload(path, bytes, { contentType: type.mime, cacheControl: '31536000' });
  if (uploadError) return fail('upload', uploadError);

  const { data, error } = await db.from('plate_artworks').insert({
    [owner.column]: owner.id, path, width, height, bytes: file.size, created_by: by,
    file_name: String(form.get('name') ?? '').trim().slice(0, 200) || 'Artwork',
  }).select().single();
  if (error) {
    await store.remove([path]); // no row points at it
    return fail('insert', error);
  }
  // Best effort: what's left over expires by itself. Earlier ones only: two
  // people attaching at once must not delete each other's.
  try {
    const old = await db.from('plate_artworks').select('id, path')
      .eq(owner.column, owner.id).lt('created_at', data.created_at).is('removed_at', null);
    if (old.error) throw old.error;
    await deleteArtworkFiles((await splitByIssuedCards((old.data ?? []) as Stored[])).free);
  } catch (e) {
    console.error('[artwork] replace', e);
  }
  return NextResponse.json({ artwork: data }, { status: 201 });
}
