// src/app/api/related/route.ts
// ============================================================
// GET /api/related?plate=<id> | ?die=<id> | ?shade_card=<id>
// Every order, job card, plate, die and shade card connected to one record.
// Any signed-in department, read with its own session: nothing here that it
// can't already open. No prices are selected.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { dieUpsFor } from '@/lib/plateDie';
import { escapeLike } from '@/lib/search';
import type { Die } from '@/lib/types';
import {
  dieItem, jobCardItem, orderItem, plateItem, pmKey, pmKeys, shadeItem,
  type CardRow, type DieRow, type LineRow, type PlateRow, type RelatedGroup, type ShadeRow,
} from '@/lib/related';

const UUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const PLATE = 'id, party, pm_code, item_name, plate_id, die_id, across_size, around_size, cylinder, location';
const DIE   = 'id, serial_no, job_name, location, ups, status, length, width, cylinder';
const SHADE = 'id, shade_card_number, product_name, party, status, pm_code';
// ponytail: a code shared by hundreds of records shows its newest; the page's own search has the rest.
const MAX_CODES = 60, MAX_ROWS = 200, MAX_IDS = 60;

function rows<T>(res: { data: unknown; error: { message: string } | null } | null): T[] {
  if (res?.error) throw new Error(res.error.message);
  return (res?.data ?? []) as T[];
}
const inList = (column: string, ids: string[]) => (ids.length ? [`${column}.in.(${ids.slice(0, MAX_IDS).join(',')})`] : []);
const uniq = (list: (string | null | undefined)[]) => Array.from(new Set(list.filter((v): v is string => !!v)));
/** "this code, any case", for each code. */
const byCodes = (codes: string[]) => codes.slice(0, MAX_CODES)
  .map((c) => `pm_code.ilike."${escapeLike(c).replace(/["\\]/g, '\\$&')}"`).join(',');

export async function GET(request: NextRequest) {
  const db = await createServerSupabaseClient();
  const user = await getClaimsUser(db);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const kind = (['plate', 'die', 'shade_card'] as const).find((k) => params.get(k));
  const id = kind ? params.get(kind)! : '';
  if (!kind || !UUID.test(id)) return NextResponse.json({ error: 'Which record?' }, { status: 400 });

  try {
    const table = kind === 'plate' ? 'plates' : kind === 'die' ? 'dies' : 'shade_cards';
    const columns = kind === 'plate' ? PLATE : kind === 'die' ? DIE : SHADE;
    const [self] = rows<Record<string, unknown>>(await db.from(table).select(columns).eq('id', id).limit(1));
    if (!self) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    // ── Plates: what the PM codes come from ──
    // A die has no PM code: its linked plates give them, and those made on it
    // by a job card; failing both, the plates of its size and cylinder.
    let plates: PlateRow[] = [];
    let codes: string[];
    let dieNote: string | undefined;
    if (kind === 'die') {
      const die = self as unknown as DieRow;
      const used = rows<{ plate_id: string | null }>(await db.from('job_cards').select('plate_id').eq('die_id', id).not('plate_id', 'is', null).limit(MAX_ROWS));
      plates = rows<PlateRow>(await db.from('plates').select(PLATE)
        .or([`die_id.eq.${id}`, ...inList('id', uniq(used.map((c) => c.plate_id)))].join(',')).limit(MAX_ROWS));
      if (plates.length === 0 && die.cylinder != null) {
        const same = rows<PlateRow>(await db.from('plates').select(PLATE).eq('cylinder', die.cylinder).order('created_at', { ascending: false }).limit(1000));
        plates = same.filter((p) => dieUpsFor([self as unknown as Die], p.across_size ?? '', p.around_size ?? '', String(p.cylinder)).dies.length > 0);
        dieNote = 'No plate is linked to this die yet: these are of the same size and cylinder.';
      }
      codes = pmKeys(plates);
    } else {
      const code = pmKey(self.pm_code as string | null);
      codes = code ? [code] : [];
      plates = codes.length ? rows<PlateRow>(await db.from('plates').select(PLATE).or(byCodes(codes)).order('created_at', { ascending: false }).limit(MAX_ROWS)) : [];
    }

    // ── By PM code ──
    const code = byCodes(codes);
    const [lineRes, shadeRes] = await Promise.all([
      code ? db.from('job_separations').select('id, sr_no, party, po_no, pm_code, material_name, quantity, jc_status, cancelled_at')
        .or(code).order('created_at', { ascending: false }).limit(MAX_ROWS) : null,
      code ? db.from('shade_cards').select(SHADE).eq('is_current', true).or(code).order('updated_at', { ascending: false }).limit(MAX_ROWS) : null,
    ]);
    const lines = rows<LineRow>(lineRes);

    // ── By id ──
    const plateIds = kind === 'plate' ? [id] : dieNote ? [] : plates.map((p) => p.id);
    const cardFilter = [
      ...inList('plate_id', plateIds), ...(dieNote ? [] : inList('job_separation_id', lines.map((l) => l.id))), ...(dieNote || !code ? [] : [code]),
      ...(kind === 'die' ? [`die_id.eq.${id}`] : []), ...(kind === 'shade_card' ? [`shade_card_id.eq.${id}`] : []),
    ].join(',');
    const cards = cardFilter ? rows<CardRow & { die_id: string | null }>(await db.from('job_cards')
      .select('id, card_number, manual, party, job_name, part, part_name, issued_at, die_id, job_separations(sr_no)')
      .or(cardFilter).order('created_at', { ascending: false }).limit(MAX_ROWS)) : [];
    // Drafts are for whoever makes cards; the rest see issued ones.
    const seen = canDeptEditJobCards(perms) ? cards : cards.filter((c) => c.issued_at);

    const linkedDies = kind === 'plate' ? uniq([self.die_id as string | null]) : uniq(plates.map((p) => p.die_id));
    const dieIds = kind === 'die' ? [] : uniq([...linkedDies, ...seen.map((c) => c.die_id)]);
    const dies = dieIds.length ? rows<DieRow>(await db.from('dies').select(DIE).in('id', dieIds.slice(0, MAX_IDS))) : [];

    const groups: RelatedGroup[] = [
      { key: 'orders', title: 'Orders', note: dieNote && lines.length ? 'Orders of those plates’ PM codes.' : undefined, items: lines.map(orderItem) },
      { key: 'jobCards', title: 'Job cards', items: seen.map(jobCardItem) },
      { key: 'plates', title: kind === 'plate' ? 'Other plates of this PM code' : 'Plates', note: dieNote,
        items: plates.filter((p) => p.id !== id).map((p) => plateItem(p, kind === 'die' && p.die_id === id)) },
      { key: 'dies', title: 'Dies', items: dies.map((d) => dieItem(d, linkedDies.includes(d.id))) },
      { key: 'shadeCards', title: 'Shade cards', items: rows<ShadeRow>(shadeRes).filter((c) => c.id !== id).map(shadeItem) },
    ];
    return NextResponse.json({ groups: groups.filter((g) => g.items.length > 0), limit: MAX_ROWS });
  } catch (e) {
    console.error('[GET /api/related]', e);
    return NextResponse.json({ error: 'Failed to load related records' }, { status: 500 });
  }
}
