// src/lib/api/jobCardSources.ts
// The records a job card is filled from, for one Job Separation line, and the
// checks the job card routes share. Each lookup throws on error: a failed
// read must not look like "no plate".

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Die, FlatbedDie, Plate } from '@/lib/types';
import { lineOfManual, type BomHint, type CardLine, type JobCardRow, type JobCardSources } from '@/lib/jobCard';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards } from '@/lib/constants/departments';
import { appMetaOf, deptKeyOf } from '@/lib/identity';
import { usernameOf } from '@/lib/username';
import type { ArtworkRow } from '@/lib/artwork';
import { isPlaceholderPm } from '@/lib/plateDie';
import { escapeLike } from '@/lib/search';

/** Who is making the card (job_card_edit) or deleting one (Admin only), or the
 *  response that refuses them. */
export async function jobCardWriter(need: 'edit' | 'admin' = 'edit'): Promise<{ name: string; username: string } | { denied: NextResponse }> {
  const user = await getClaimsUser(await createServerSupabaseClient());
  if (!user) return { denied: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms || !canDeptEditJobCards(perms)) {
    return { denied: NextResponse.json({ error: 'Your department cannot make job cards' }, { status: 403 }) };
  }
  if (need === 'admin' && !perms.isSuperAdmin) {
    return { denied: NextResponse.json({ error: 'Only Admin can delete a job card' }, { status: 403 }) };
  }
  return { name: user.email ?? perms.key, username: usernameOf(appMetaOf(user), user.email) };
}

/** The database's own refusals (migration 107) read as they are; the rest don't leak. */
export function jobCardDbError(error: { code?: string; message: string }): NextResponse {
  if (error.code === '23514' && !error.message.includes('constraint')) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error.code === '23514') return NextResponse.json({ error: 'Some values are not allowed' }, { status: 400 });
  if (error.code === '23505') return NextResponse.json({ error: 'This job card number is already used' }, { status: 409 });
  if (error.code === '23503') return NextResponse.json({ error: 'A linked record no longer exists' }, { status: 400 });
  if (error.code === '22P02') return NextResponse.json({ error: 'Job card not found' }, { status: 404 });
  console.error('[job cards]', error);
  return NextResponse.json({ error: 'Failed to save the job card' }, { status: 500 });
}

type LinkRow = Omit<JobCardSources['linkable'][number], 'cards'> & { job_cards: { id: string }[] };
type BomRow = {
  job_separation_id: string;
  material_id: string | null;
  material_width_mm: number | null;
  bom_materials: { name: string } | null;
};

function rows<T>(res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
}

const ids = (list: (string | null | undefined)[]) => Array.from(new Set(list.filter((v): v is string => !!v)));

async function loadLine(db: SupabaseClient, id: string) {
  const [lineRes, cardRes] = await Promise.all([
    db.from('job_separations')
      .select('id, sr_no, party, po_no, po_date, pm_code, material_name, quantity, cancelled_at').eq('id', id).limit(1),
    db.from('job_cards').select('*').eq('job_separation_id', id).order('part'),
  ]);
  const [line] = rows<CardLine>(lineRes);
  return line ? { line, cards: rows<JobCardRow>(cardRes) } : null;
}

const nothing = { plates: [], dies: [], flatbedDies: [], shadeCards: [], bom: [], lastCards: [], artworks: [], papers: [], linkable: [] };

/** For departments that only look: the line and its issued cards. */
export async function loadIssuedCards(db: SupabaseClient, id: string): Promise<JobCardSources | null> {
  const head = await loadLine(db, id);
  return head && { ...nothing, line: head.line, cards: head.cards.filter((c) => c.issued_at) };
}

export async function loadJobCardSources(db: SupabaseClient, id: string): Promise<JobCardSources | null> {
  const head = await loadLine(db, id);
  return head && fill(db, head.line, head.cards);
}

/** The same, from one card: its line's when it has one, else its typed order's. */
/** A manual card not saved yet, or being retyped: what its typed PM code, and a plate picked for it, lead to. */
export async function loadSourcesOfCard(db: SupabaseClient, cardId: string, { onlyIssued = false, pm, plate }: { onlyIssued?: boolean; pm?: string | null; plate?: string | null } = {}): Promise<JobCardSources | null> {
  if (cardId === 'new') return fill(db, { ...lineOfManual(null), pm_code: pm ?? null }, [], plate);
  const [card] = rows<JobCardRow>(await db.from('job_cards').select('*').eq('id', cardId).limit(1));
  if (!card || (onlyIssued && !card.issued_at)) return null;
  if (card.job_separation_id) {
    return onlyIssued ? loadIssuedCards(db, card.job_separation_id) : loadJobCardSources(db, card.job_separation_id);
  }
  const line = lineOfManual(card.manual);
  return onlyIssued ? { ...nothing, line, cards: [card] } : fill(db, { ...line, pm_code: pm ?? line.pm_code }, [card]);
}

async function fill(db: SupabaseClient, line: CardLine, cards: JobCardRow[], plate?: string | null): Promise<JobCardSources> {
  // "N/A" and the like are on many unrelated records: they link nothing.
  const pm = line.pm_code?.trim() ?? '';
  const byPm = pm && !isPlaceholderPm(pm)
    ? [`pm_code.ilike."${escapeLike(pm).replace(/["\\]/g, '\\$&')}"`] : [];
  // Records picked on a card by hand come too, whatever their PM code.
  const anyOf = (picked: string[], filters = byPm) =>
    [...filters, ...(picked.length ? [`id.in.(${picked.join(',')})`] : [])].join(',');
  const plateFilter = anyOf(ids([...cards.map((c) => c.plate_id), plate]));
  const shadeFilter = anyOf(ids(cards.map((c) => c.shade_card_id)));
  const bomFilter = anyOf(line.id ? [line.id] : []);

  const [plateRes, shadeRes, bomRes, flatRes, paperRes] = await Promise.all([
    plateFilter ? db.from('plates').select('*').or(plateFilter).order('created_at', { ascending: false }) : null,
    shadeFilter ? db.from('shade_cards').select('id, product_name, shade_card_number, status, making_status')
      .eq('is_current', true).or(shadeFilter).order('updated_at', { ascending: false }) : null,
    // Material name and width only: rates are gated elsewhere.
    bomFilter ? db.from('bom_costings')
      .select('job_separation_id, material_id, material_width_mm, bom_materials(name), job_separations!inner(pm_code)')
      .or(bomFilter, { referencedTable: 'job_separations' })
      .not('material_id', 'is', null).order('updated_at', { ascending: false }).limit(20) : null,
    db.from('flatbed_dies').select('*'),
    db.from('bom_materials').select('name, specification').eq('is_active', true).order('name'),
  ]);

  const plates = plateRes ? rows<Plate>(plateRes) : [];
  const plateIds = plates.map((p) => p.id);
  // Not this line's own cards, nor this manual card itself. (NULL is never "not equal" in SQL.)
  const others = line.id ? `job_separation_id.is.null,job_separation_id.neq.${line.id}` : cards.length ? `id.not.in.(${cards.map((c) => c.id).join(',')})` : 'id.not.is.null';
  const artFilter = [...(plateIds.length ? [`plate_id.in.(${plateIds.join(',')})`] : []), ...(cards.length ? [`job_card_id.in.(${cards.map((c) => c.id).join(',')})`] : [])].join(',');
  const [lastRes, artRes, lineRes] = await Promise.all([
    plateIds.length ? db.from('job_cards').select('*')
      .in('plate_id', plateIds).not('issued_at', 'is', null).or(others)
      .order('issued_at', { ascending: false }).limit(50) : null,
    artFilter ? db.from('plate_artworks').select('*').or(artFilter).order('created_at', { ascending: false }).limit(200) : null,
    // A manual card may be linked to the order once it is entered.
    !line.id && byPm.length ? db.from('job_separations').select('id, sr_no, party, po_no, material_name, quantity, job_cards(id)')
      .or(byPm.join(',')).is('cancelled_at', null).order('created_at', { ascending: false }).limit(20) : null,
  ]);
  const lastCards = lastRes ? rows<JobCardRow>(lastRes) : [];

  const cylinders = Array.from(new Set(plates.map((p) => p.cylinder).filter((c): c is number => c != null)));
  const dieFilter = anyOf(ids([...plates, ...cards, ...lastCards].map((r) => r.die_id)),
    cylinders.length ? [`cylinder.in.(${cylinders.join(',')})`] : []);
  const dies = dieFilter ? rows<Die>(await db.from('dies').select('*').or(dieFilter)) : [];

  const bom: BomHint[] = (bomRes ? rows<BomRow>(bomRes) : [])
    .filter((b) => b.material_id && b.bom_materials)
    .map((b) => ({
      material_id: b.material_id!, material_name: b.bom_materials!.name,
      width_mm: b.material_width_mm, same_line: b.job_separation_id === line.id,
    }))
    .sort((a, b) => Number(b.same_line) - Number(a.same_line));

  return {
    line, plates, dies, bom, cards, lastCards,
    linkable: (lineRes ? rows<LinkRow>(lineRes) : []).map(({ job_cards, ...l }) => ({ ...l, cards: job_cards.length })),
    artworks: artRes ? rows<ArtworkRow>(artRes) : [],
    flatbedDies: rows<FlatbedDie>(flatRes),
    papers: rows<JobCardSources['papers'][number]>(paperRes),
    shadeCards: shadeRes ? rows<JobCardSources['shadeCards'][number]>(shadeRes) : [],
  };
}
