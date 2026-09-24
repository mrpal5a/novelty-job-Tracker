// src/app/api/paper-stock/[id]/route.ts
// ============================================================
// PATCH  /api/paper-stock/[id] — correct one roll. paper_stock_manage.
//        { remaining_meter?, note?, location?, supplier? }
//        remaining_meter goes through adjust_paper_roll so the change is
//        logged as an 'adjust' movement (recount, damage, write-off to 0);
//        `note` is the reason on that movement. Location/supplier are
//        plain edits.
// DELETE /api/paper-stock/[id] — remove a roll entered by mistake. Only
//        while nothing has been issued from it: once a job has used it,
//        it's history — adjust it to 0 instead.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePaperStock, text, rpcError } from '@/lib/api/paperStockGate';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requirePaperStock('manage');
  if ('error' in gate) return gate.error;

  const body = await request.json();
  const admin = createAdminClient();

  const patch: Record<string, unknown> = {};
  if ('location' in body) patch.location = text(body.location);
  if ('supplier' in body) patch.supplier = text(body.supplier);
  if (Object.keys(patch).length > 0) {
    const { error } = await admin.from('paper_rolls').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if ('remaining_meter' in body) {
    const remaining = Number(body.remaining_meter);
    if (body.remaining_meter === '' || body.remaining_meter === null || !Number.isFinite(remaining) || remaining < 0) {
      return NextResponse.json({ error: 'Remaining metres must be 0 or more' }, { status: 400 });
    }
    const { error } = await admin.rpc('adjust_paper_roll', {
      p_roll_id:   id,
      p_remaining: Math.round(remaining * 100) / 100,
      p_note:      text(body.note),
      p_by:        gate.by,
    });
    if (error) return rpcError(error);
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const gate = await requirePaperStock('manage');
  if ('error' in gate) return gate.error;

  const admin = createAdminClient();

  const { count, error: countError } = await admin
    .from('paper_stock_movements')
    .select('id', { count: 'exact', head: true })
    .eq('roll_id', id)
    .neq('kind', 'receive');
  if (countError) return NextResponse.json({ error: countError.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'This roll has been used or adjusted — set its remaining metres to 0 instead of deleting' },
      { status: 409 },
    );
  }

  const { error } = await admin.from('paper_rolls').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
