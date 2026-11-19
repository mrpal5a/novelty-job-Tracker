// src/app/api/search/preview/route.ts
// ============================================================
// GET /api/search/preview?kind=plate&id=… — one row in full, for the Ctrl K
// palette's preview panel (the row the arrow keys or mouse are on).
// ============================================================
//
// Same visibility as /api/search: open to any signed-in user, except label
// stock (departments that can see stock only; RLS enforces it again).
// Columns are listed, not '*': no money columns on Job Separation, as in
// /api/search, since not every department may see them.

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptViewStock } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';

const KINDS = {
  job: {
    table: 'jobs',
    columns: 'id, job_card_number, po_number, po_date, party, job_name, pm_code, label_qty, dispatched_qty, remaining_qty, delivery_date, status, urgent, job_type, printing_method, is_closed, halt_remark, notes, printing_units(name)',
  },
  plate: {
    table: 'plates',
    columns: 'id, party, pm_code, item_name, across_size, around_size, cylinder, plate_id, plate_date, label_per_round, location',
  },
  die: {
    table: 'dies',
    columns: 'id, serial_no, job_name, length, width, cylinder, material, ups, gap, corner, location, status, die_received_on, damage_reason',
  },
  flatbed: {
    table: 'flatbed_dies',
    columns: 'id, serial_no, shape, length, width, repeat_length, ups, gap, corner, location, die_received_on',
  },
  separation: {
    table: 'job_separations',
    columns: 'id, sr_no, party, po_no, po_date, pm_code, material_name, quantity, unit, job_status, jc_status, aw_send_to, linked_job_card_number, cancelled_at, cancel_reason',
  },
  shade: {
    table: 'shade_cards',
    columns: 'id, shade_card_number, party, product_name, pm_code, docket_number, status, making_status, prepared_date, sent_to_party_date, received_back_date, approval_date, version, notes',
  },
  stock: {
    table: 'label_stock',
    columns: 'id, kind, qty, party, job_name, job_card_number, po_number, pm_code, location, remark, created_at',
  },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const kind = params.get('kind') ?? '';
  const id = params.get('id') ?? '';
  if (!Object.hasOwn(KINDS, kind) || !UUID.test(id)) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if (kind === 'stock' && !canDeptViewStock(await getDeptPermissions(deptKeyOf(user)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // string, not the literal: parsing the select strings' types hits TS2589.
  const { table, columns }: { table: string; columns: string } = KINDS[kind as keyof typeof KINDS];
  const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle();
  if (error) {
    console.error('[GET /api/search/preview]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ row: data });
}
