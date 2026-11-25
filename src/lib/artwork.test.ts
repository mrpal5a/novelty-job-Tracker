import { describe, it, expect } from 'vitest';
import { artworkSize, artworkType, expiredArtworks, openLines, WHOLE } from './artwork';

const NOW = Date.parse('2026-11-25T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('artwork clean-up', () => {
  const art = (id: string, plate_id: string | null, used: number) => ({ id, plate_id, last_used_at: daysAgo(used) });
  it('goes 90 days after its last use', () => {
    expect(expiredArtworks([art('a', 'p', 89), art('b', 'p', 91), art('c', null, 91)], new Set(), NOW).map((a) => a.id)).toEqual(['b', 'c']);
  });
  it('waits for an open order, up to 180 days', () => {
    expect(expiredArtworks([art('a', 'p', 120), art('b', 'p', 181)], new Set(['p']), NOW).map((a) => a.id)).toEqual(['b']);
  });
  it('calls a line open until all of it is dispatched; cancelled never', () => {
    const line = (id: string, quantity: number | null, cancelled_at: string | null = null) => ({ id, quantity, cancelled_at });
    const lines = [line('done', 100), line('part', 100), line('none', null), line('cancelled', 100, 'x')];
    expect(openLines(lines, new Map([['done', 100], ['part', 60]])).map((l) => l.id)).toEqual(['part', 'none']);
  });
});

describe('artwork files', () => {
  it('are known by their bytes, not their name', () => {
    expect(artworkType(new TextEncoder().encode('RIFF....WEBPVP8 '))?.ext).toBe('webp');
    expect(artworkType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.ext).toBe('jpg');
    expect(artworkType(new TextEncoder().encode('<svg onload=1>'))).toBeNull();
    expect(artworkType(new Uint8Array())).toBeNull();
  });
  it('shrink to the print box, whichever side is longer, and are never enlarged', () => {
    expect(artworkSize({ width: 3056, height: 1528 }, WHOLE)).toEqual({ width: 1528, height: 764 });
    expect(artworkSize({ width: 1000, height: 3056 }, WHOLE)).toEqual({ width: 500, height: 1528 });
    expect(artworkSize({ width: 400, height: 300 }, WHOLE)).toEqual({ width: 400, height: 300 });
    // A PDF page has no pixels of its own: it may be drawn larger than its points.
    expect(artworkSize({ width: 764, height: 382 }, { x: 0, y: 0, w: 1, h: 1 }, 10)).toEqual({ width: 1528, height: 764 });
    expect(artworkSize({ width: 3056, height: 3056 }, { x: 0.5, y: 0, w: 0.5, h: 0.25 })).toEqual({ width: 1528, height: 764 });
  });
});
