// src/app/api/cron/artwork-cleanup/route.ts
// ============================================================
// GET /api/cron/artwork-cleanup — daily, 02:30 IST (vercel.json). Deletes
// artwork files 90 days after their last use (180 while an order with that PM
// code is open). What fails is tried again the next day. Protected by CRON_SECRET in the middleware.
// ============================================================

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deleteArtworkFiles } from '@/lib/api/artworkFiles';
import { allPages } from '@/lib/api/allPages';
import { dispatchedPerLine } from '@/lib/api/dispatchedPerLine';
import { ARTWORK_DAYS, expiredArtworks, openLines } from '@/lib/artwork';
import { pmKey } from '@/lib/related';

export const dynamic = 'force-dynamic';

type Stored = { id: string; path: string; plate_id: string | null; last_used_at: string; plates: { pm_code: string | null } | null };
type Line = { id: string; pm_code: string | null; quantity: number | null; cancelled_at: string | null };

export async function GET() {
  const db = createAdminClient();
  try {
    const cutoff = new Date(Date.now() - ARTWORK_DAYS * 86_400_000).toISOString();
    const stored = await allPages<Stored>((from, to) => db.from('plate_artworks')
      .select('id, path, plate_id, last_used_at, plates(pm_code)')
      .is('removed_at', null).lt('last_used_at', cutoff).order('id').range(from, to) as never);
    if (stored.length === 0) return NextResponse.json({ removed: 0 });

    const [lines, dispatched] = await Promise.all([
      allPages<Line>((from, to) => db.from('job_separations')
        .select('id, pm_code, quantity, cancelled_at').is('cancelled_at', null).order('id').range(from, to)),
      dispatchedPerLine(),
    ]);
    const openCodes = new Set(openLines(lines, dispatched).map((l) => pmKey(l.pm_code)));
    const openPlates = new Set(stored.filter((a) => {
      const code = pmKey(a.plates?.pm_code);
      return code !== null && openCodes.has(code);
    }).map((a) => a.plate_id!));

    const gone = expiredArtworks(stored, openPlates, Date.now());
    await deleteArtworkFiles(gone);
    console.log(`[cron artwork-cleanup] removed ${gone.length}`);
    return NextResponse.json({ removed: gone.length });
  } catch (e) {
    console.error('[cron artwork-cleanup]', e);
    return NextResponse.json({ error: 'Clean-up failed' }, { status: 500 });
  }
}
