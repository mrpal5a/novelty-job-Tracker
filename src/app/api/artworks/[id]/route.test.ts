import { respond, signIn, writes } from '@/test/api';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { DELETE, GET } from './route';

const get = (id = '11111111-1111-4111-8111-111111111111') =>
  GET(new NextRequest(`http://x/api/artworks/${id}`), { params: Promise.resolve({ id }) });

describe('opening artwork', () => {
  it('is for signed-in departments only, and says when a file is gone', async () => {
    signIn(null);
    expect((await get()).status).toBe(401);
    signIn('Viewer');
    expect((await get('not-an-id')).status).toBe(404);
    respond((c) => (c.table === 'plate_artworks' ? { data: { path: 'x', last_used_at: '2026-01-01', removed_at: '2026-04-01' } } : undefined));
    expect((await get()).status).toBe(410);
    expect(writes()).toEqual([]); // a removed file isn't in use
  });
});

describe('removing artwork', () => {
  const ID = '11111111-1111-4111-8111-111111111111', OLD = '22222222-2222-4222-8222-222222222222';
  const del = () => DELETE(new NextRequest(`http://x/api/artworks/${ID}`, { method: 'DELETE' }), { params: Promise.resolve({ id: ID }) });

  it('needs the job card permission', async () => {
    signIn('Dispatch');
    expect((await del()).status).toBe(403);
  });
  it('takes every one off the plate, and keeps the files issued cards print', async () => {
    signIn('Prepress');
    respond((c) => {
      if (c.table === 'job_cards') return { data: [{ art: ID }, { art: OLD }] };
      if (c.table !== 'plate_artworks' || c.op !== 'select') return undefined;
      return c.filters.some(([f]) => f === 'maybeSingle')
        ? { data: { id: ID, plate_id: 'p', removed_at: null } }
        : { data: [{ id: ID, path: 'a' }, { id: OLD, path: 'b' }] };
    });
    expect(await (await del()).json()).toEqual({ ok: true, keptForIssued: 2 });
    expect(writes('plate_artworks').map((w) => w.payload)).toEqual([{ plate_id: null, job_card_id: null }]); // nothing deleted
  });
  it('says so when it is already gone', async () => {
    signIn('Prepress');
    respond((c) => (c.table === 'plate_artworks' ? { data: { id: ID, plate_id: 'p', removed_at: '2026-01-01' } } : undefined));
    expect((await del()).status).toBe(404);
  });
});
