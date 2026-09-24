// src/app/api/paper-stock/issue/route.ts
// ============================================================
// POST   /api/paper-stock/issue — "Use from stock" on a BOM row.
//        { job_separation_id, meters, note? }. bom_use.
//        Material and width come from the row's SAVED costing, never from
//        the request body — the same rule Request follows, so what's
//        issued is always what the sheet says the job needs.
//
// Returning leftover metres is POST /api/paper-stock/return.
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
  if (meters === null) return NextResponse.json({ error: 'Metres to issue must be a number above 0' }, { status: 400 });

  const admin = createAdminClient();
  const { data: costing, error: costingError } = await admin
    .from('bom_costings')
    .select('material_id, material_width_mm')
    .eq('job_separation_id', jobId)
    .maybeSingle();
  if (costingError) return NextResponse.json({ error: costingError.message }, { status: 500 });
  if (!costing?.material_id || !costing.material_width_mm) {
    return NextResponse.json({ error: 'Save a material and width on this row first' }, { status: 400 });
  }

  const { error } = await admin.rpc('issue_paper_stock', {
    p_material_id:       costing.material_id,
    p_width_mm:          costing.material_width_mm,
    p_meters:            meters,
    p_job_separation_id: jobId,
    p_note:              text(body.note),
    p_by:                gate.by,
  });
  if (error) return rpcError(error);

  return NextResponse.json({ issued: meters });
}
