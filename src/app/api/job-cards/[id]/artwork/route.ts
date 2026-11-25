// src/app/api/job-cards/[id]/artwork/route.ts
// ============================================================
// POST /api/job-cards/[id]/artwork — attach artwork to a card that has no
// plate to keep it on. Needs job_card_edit.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { jobCardWriter } from '@/lib/api/jobCardSources';
import { saveArtwork } from '@/lib/api/artworkFiles';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };
const UUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const writer = await jobCardWriter();
  if ('denied' in writer) return writer.denied;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Job card not found' }, { status: 404 });
  return saveArtwork(request, { column: 'job_card_id', id }, writer.name);
}
