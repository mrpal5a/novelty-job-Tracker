// src/lib/artwork.ts
// The artwork on a job card: how big it is kept, how long, and which files
// have had their day. Pure; the clean-up is api/cron/artwork-cleanup.

export const ARTWORK_BUCKET = 'artwork';
/** Print width of the sheet (194 mm) at 200 dpi; nothing is kept larger. */
export const ARTWORK_MAX_PX = 1528;
/** The bucket's own limit (migration 110). Normal files are near 400 KB. */
export const ARTWORK_MAX_BYTES = 2 * 1024 * 1024;

/** Days kept after the last use (attached, opened on a card, issued). */
export const ARTWORK_DAYS = 90;
/** An order not yet fully dispatched holds its artwork longer, but not for
 *  ever: not every dispatch can be matched to its line. */
export const ARTWORK_OPEN_DAYS = 180;

/** Supabase Free: 1 GB of files. Warned well before. */
export const STORAGE_LIMIT_BYTES = 1024 ** 3;
export const STORAGE_WARN_BYTES = 700 * 1024 ** 2;

/** One row of plate_artworks (migration 110). */
export type ArtworkRow = {
  id: string; plate_id: string | null; job_card_id: string | null; path: string; file_name: string;
  width: number; height: number; bytes: number;
  created_by: string | null; created_at: string; last_used_at: string; removed_at: string | null;
};

const DAY = 86_400_000;

/** The stored files to delete now. `openPlates`: plates with an order still open. */
export function expiredArtworks<T extends Pick<ArtworkRow, 'plate_id' | 'last_used_at'>>(
  stored: T[], openPlates: Set<string>, now: number,
): T[] {
  return stored.filter((a) => {
    const days = (now - Date.parse(a.last_used_at)) / DAY;
    return days > (a.plate_id && openPlates.has(a.plate_id) ? ARTWORK_OPEN_DAYS : ARTWORK_DAYS);
  });
}

/** Lines not fully dispatched. No quantity: can't be known to be done. */
export function openLines<T extends { id: string; quantity: number | null; cancelled_at: string | null }>(
  lines: T[], dispatched: Map<string, number>,
): T[] {
  return lines.filter((l) => !l.cancelled_at && (l.quantity == null || (dispatched.get(l.id) ?? 0) < l.quantity));
}

/** What the bytes say the file is, whatever its name or header claims. */
export function artworkType(b: Uint8Array): { mime: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg' } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...Array.from(b.subarray(from, to)));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

export type Crop = { x: number; y: number; w: number; h: number }; // parts of the page, 0–1
export const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 };

/** Pixels to draw a crop of a page at: fits the print box, never enlarged
 *  past `scale` × the page's own size. */
export function artworkSize(page: { width: number; height: number }, crop: Crop, maxScale = 1): { width: number; height: number } {
  const w = page.width * crop.w, h = page.height * crop.h;
  const scale = Math.min(ARTWORK_MAX_PX / w, ARTWORK_MAX_PX / h, maxScale);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}
