import { respond, signIn, writes } from '@/test/api';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

const ID = '11111111-1111-4111-8111-111111111111';
const send = (bytes: BlobPart, size = { width: '1528', height: '1270' }) => {
  const form = new FormData();
  form.set('file', new File([bytes], 'a.webp', { type: 'image/webp' }));
  form.set('width', size.width);
  form.set('height', size.height);
  return POST(new NextRequest(`http://x/api/plates/${ID}/artwork`, { method: 'POST', body: form }), { params: Promise.resolve({ id: ID }) });
};

describe('attaching artwork', () => {
  beforeEach(() => { signIn('Prepress'); respond(() => undefined); });

  it('needs the job card permission', async () => {
    signIn('Dispatch');
    expect((await send('RIFF....WEBP')).status).toBe(403);
    signIn(null);
    expect((await send('RIFF....WEBP')).status).toBe(401);
  });
  it('refuses what is not a picture, is too large, or has no size', async () => {
    expect((await send('<svg onload=alert(1)>')).status).toBe(400);
    expect((await send(new Uint8Array(2 * 1024 * 1024 + 1))).status).toBe(400);
    expect((await send('RIFF....WEBP', { width: '0', height: '10' })).status).toBe(400);
  });
  it('refuses an unknown plate, and writes nothing', async () => {
    expect((await send('RIFF....WEBP')).status).toBe(404);
    expect(writes()).toEqual([]);
  });
});
