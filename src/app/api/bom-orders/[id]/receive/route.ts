// src/app/api/bom-orders/[id]/receive/route.ts
// ============================================================
// POST /api/bom-orders/[id]/receive — the delivery arrived.
//      { roll_count, meters_per_roll, location?, note? }. paper_stock_manage.
//      Everything that arrived goes to stock as rolls of the order's
//      material and width; the order and its requests are marked received.
//      Pre-filled in the UI with the ordered metres, but what's entered is
//      what counts — deliveries run short or over.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePaperStock, text, positive, rpcError } from '@/lib/api/paperStockGate';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requirePaperStock('manage');
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const count = Number(body.roll_count);
  if (!Number.isInteger(count) || count < 1 || count > 500) {
    return NextResponse.json({ error: 'Number of rolls must be a whole number from 1 to 500' }, { status: 400 });
  }
  const perRoll = positive(body.meters_per_roll);
  if (perRoll === null) return NextResponse.json({ error: 'Metres per roll must be a number above 0' }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('receive_material_order', {
    p_order_id:        id,
    p_roll_count:      count,
    p_meters_per_roll: perRoll,
    p_location:        text(body.location),
    p_note:            text(body.note),
    p_by:              gate.by,
  });
  if (error) return rpcError(error);

  return NextResponse.json({ received: Number(data ?? 0) });
}
