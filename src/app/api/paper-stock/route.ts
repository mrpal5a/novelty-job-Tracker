// src/app/api/paper-stock/route.ts
// ============================================================
// GET  /api/paper-stock — every roll with metres left, material name
//      joined. ?used=1 includes used-up rolls too. bom_use. The Inventory
//      tab and the BOM costing sheet both summarise this client-side (see
//      lib/paperStock.ts) — a shop's live rolls are a few hundred rows.
// POST /api/paper-stock — receive rolls: { material_id, width_mm,
//      roll_count, meters_per_roll, location?, supplier?, note?,
//      source_request_id? | source_request_ids? }. paper_stock_manage. "5 rolls × 2000 m" makes
//      five roll rows, each with its own ledger entry, in one transaction.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePaperStock, text, positive, rpcError } from '@/lib/api/paperStockGate';
import type { PaperRoll } from '@/lib/types';

type RawRoll = Omit<PaperRoll, 'material_name'> & {
  material: { name: string } | { name: string }[] | null;
};

function shapeRoll(r: RawRoll): PaperRoll {
  const material = Array.isArray(r.material) ? r.material[0] : r.material;
  const { material: _m, ...rest } = r;
  return {
    ...rest,
    material_name:   material?.name ?? 'Unknown material',
    width_mm:        Number(r.width_mm),
    initial_meter:   Number(r.initial_meter),
    remaining_meter: Number(r.remaining_meter),
  };
}

const ROLL_SELECT =
  'id, ref, material_id, width_mm, initial_meter, remaining_meter, location, supplier, note, ' +
  'source_request_id, received_at, created_by, material:bom_materials(name)';

export async function GET(request: NextRequest) {
  const gate = await requirePaperStock('use');
  if ('error' in gate) return gate.error;

  const includeUsed = new URL(request.url).searchParams.get('used') === '1';

  let query = gate.supabase
    .from('paper_rolls')
    .select(ROLL_SELECT)
    .order('received_at', { ascending: false })
    .limit(5000);
  if (!includeUsed) query = query.gt('remaining_meter', 0);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rolls: ((data ?? []) as unknown as RawRoll[]).map(shapeRoll) });
}

export async function POST(request: NextRequest) {
  const gate = await requirePaperStock('manage');
  if ('error' in gate) return gate.error;

  const body = await request.json();

  const materialId = text(body.material_id);
  if (!materialId) return NextResponse.json({ error: 'Pick a material' }, { status: 400 });

  const width = positive(body.width_mm);
  if (width === null) return NextResponse.json({ error: 'Width must be a number above 0' }, { status: 400 });

  const count = Number(body.roll_count);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return NextResponse.json({ error: 'Number of rolls must be a whole number from 1 to 500' }, { status: 400 });
  }

  const perRoll = positive(body.meters_per_roll);
  if (perRoll === null) return NextResponse.json({ error: 'Metres per roll must be a number above 0' }, { status: 400 });

  // One delivery can answer several requests (Requests → By material →
  // Receive). The rolls link to the first; every one is marked received.
  const requestIds: string[] = Array.isArray(body.source_request_ids)
    ? body.source_request_ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    : text(body.source_request_id) ? [text(body.source_request_id)!] : [];

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('receive_paper_rolls', {
    p_material_id:       materialId,
    p_width_mm:          width,
    p_roll_count:        count,
    p_meters_per_roll:   perRoll,
    p_location:          text(body.location),
    p_supplier:          text(body.supplier),
    p_note:              text(body.note),
    p_source_request_id: requestIds[0] ?? null,
    p_by:                gate.by,
  });

  if (error) {
    if (error.code === '23503') return NextResponse.json({ error: 'That material no longer exists' }, { status: 400 });
    return rpcError(error);
  }

  if (requestIds.length > 1) {
    const { error: markError } = await admin
      .from('bom_material_requests')
      .update({ received_at: new Date().toISOString() })
      .in('id', requestIds.slice(1))
      .is('received_at', null);
    if (markError) return NextResponse.json({ error: `Rolls added, but marking requests received failed: ${markError.message}` }, { status: 500 });
  }

  return NextResponse.json({ created: (data ?? []).length }, { status: 201 });
}
