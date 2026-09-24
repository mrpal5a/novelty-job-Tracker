// src/app/api/paper-stock/return/route.ts
// ============================================================
// POST /api/paper-stock/return — leftover paper back into stock after
//      printing. { job_separation_id, meters, note? }. bom_use.
//      Goes back onto the roll the job took from last (the one coming off
//      the press); can't exceed what the job has out. See
//      return_paper_stock_for_job in migration 063.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePaperStock, text, positive, rpcError } from '@/lib/api/paperStockGate';

export async function POST(request: NextRequest) {
  const gate = await requirePaperStock('use');
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const jobId = text(body.job_separation_id);
  if (!jobId) return NextResponse.json({ error: 'Missing job' }, { status: 400 });

  const meters = positive(body.meters);
  if (meters === null) return NextResponse.json({ error: 'Metres to return must be a number above 0' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('return_paper_stock_for_job', {
    p_job_separation_id: jobId,
    p_meters:            meters,
    p_note:              text(body.note),
    p_by:                gate.by,
  });
  if (error) return rpcError(error);

  return NextResponse.json({ returned: Number(data ?? 0) });
}
