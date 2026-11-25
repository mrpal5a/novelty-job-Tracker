// src/app/api/job-separations/route.ts
// ============================================================
// GET  /api/job-separations  — the live worksheet (any authenticated user);
//      with dispatch_qty_view or _edit, each row carries `dispatched`: labels entered
//      against it, or null
// POST /api/job-separations  — add a row (Prepress or Admin)
// ============================================================

import { lineCardState, type CardStateRow, type JobCardState } from '@/lib/jobCard';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageJobSeparation, canDeptSeeDispatchedQty, canDeptSeeMoneyTotals, canDeptSeePrices } from '@/lib/constants/departments';
import { parseDateRange, rangeOrClause, parseLimit, type DateRange } from '@/lib/jobSeparationQuery';
import { containsPattern, orContains, onSearchText, searchAsPhrase, searchTerms } from '@/lib/search';
import { deptKeyOf } from '@/lib/identity';
import { allPages } from '@/lib/api/allPages';
import { dispatchedPerLine } from '@/lib/api/dispatchedPerLine';
import { isIsoDate } from '@/lib/jobViews';

// Optional free text: blank means "not recorded", not an empty string.
function text(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

// Optional whole number: anything unparseable is treated as not recorded.
function integer(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Optional decimal: rate carries paise, so no truncation.
function decimal(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Field-scoped search: a whitelist, not a raw column name from the query
// string. Integer columns can't take .ilike() — see the identical note in
// src/app/api/dies/route.ts — so quantity matches on the exact number.
type JobSeparationSearchField = { column: string; type: 'text' | 'int' };

const JOB_SEPARATION_SEARCH_FIELDS: Record<string, JobSeparationSearchField> = {
  sr_no:         { column: 'sr_no',         type: 'text' },
  party:         { column: 'party',         type: 'text' },
  po_no:         { column: 'po_no',         type: 'text' },
  pm_code:       { column: 'pm_code',       type: 'text' },
  material_name: { column: 'material_name', type: 'text' },
  unit:          { column: 'unit',          type: 'text' },
  job_status:    { column: 'job_status',    type: 'text' },
  jc_status:     { column: 'jc_status',     type: 'text' },
  aw_send_to:    { column: 'aw_send_to',    type: 'text' },
  quantity:      { column: 'quantity',      type: 'int' },
};

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Logins can't read rate / order_value (migration 104), so whole rows come
  // through the service role, signed-in checked above; prices are blanked
  // below for whoever may not see them.
  const admin = createAdminClient();

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();
  const field  = searchParams.get('field')?.trim();
  // The Party box beside the search — ANDed with it ("this party's jobs").
  const party  = searchParams.get('party')?.trim();
  const range: DateRange = parseDateRange(searchParams.get('range'));
  // The Unit filter: '1' or '2'. A '1&2' line is shared, so it shows under both.
  const unitParam = searchParams.get('unit');
  const unit = unitParam === '1' || unitParam === '2' ? unitParam : null;
  const limit = parseLimit(searchParams.get('limit'));

  // ?sr_nos=AUG26-1,AUG26-7 — exact rows by Sr No, whatever their date: how
  // the Prepress to-do turns its #tags into links. Typed tags may be lower
  // case, so both spellings are asked for.
  const srNos = searchParams.get('sr_nos');
  if (srNos !== null) {
    const wanted = Array.from(new Set(
      srNos.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50).flatMap((s) => [s, s.toUpperCase()]),
    ));
    if (wanted.length === 0) return NextResponse.json({ job_separations: [], hasMore: false });
    const { data, error } = await supabase
      .from('job_separations')
      .select('id, sr_no, party, po_no, pm_code, material_name, linked_job_id, linked_job_card_number, cancelled_at')
      .in('sr_no', wanted);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ job_separations: data ?? [], hasMore: false });
  }

  const config = search && field ? JOB_SEPARATION_SEARCH_FIELDS[field] : undefined;
  const intSearch = config?.type === 'int' ? Number(search) : null;
  // Not a whole number — an integer column can't contain it, so the
  // answer is "no matches" rather than a query error.
  if (intSearch !== null && !Number.isFinite(intSearch)) return NextResponse.json({ job_separations: [] });

  // "All fields" reads search_text; see searchAsPhrase for phrase vs words.
  const terms = search && !config ? searchTerms(search) : null;
  let asPhrase = true;

  // The same range + search on any query over the table: the page of rows,
  // and the order-value total when there are more rows than the page holds.
  type Filterable<Q> = { or: (f: string) => Q; eq: (c: string, v: number) => Q; ilike: (c: string, p: string) => Q; in: (c: string, v: string[]) => Q };
  function applyFilters<Q extends Filterable<Q>>(q: Q): Q {
    // Scoped exactly the way Bill of Material scopes the same rows — see
    // src/lib/jobSeparationQuery.ts for the po_date/created_at bucketing.
    const rangeClause = rangeOrClause(range);
    if (rangeClause) q = q.or(rangeClause);
    if (party) q = q.ilike('party', containsPattern(party));
    if (unit) q = q.in('unit', [unit, '1&2']);
    if (!search) return q;
    if (config && intSearch !== null) return q.eq(config.column, Math.trunc(intSearch));
    // Picked a specific text field — search just that column.
    if (config) return q.ilike(config.column, containsPattern(search));
    // "All fields" — the shop looks this up by whatever they can read off a
    // PO: the sr. no, the party, the PO no, the PM code, or the material name.
    if (terms) return onSearchText(q, terms, asPhrase);
    // Only punctuation typed ("%"): matched as typed, as before.
    return q.or(orContains(['sr_no', 'party', 'po_no', 'pm_code', 'material_name'], search));
  }

  if (terms) {
    try {
      asPhrase = await searchAsPhrase(terms, async () => {
        const { data, error } = await applyFilters(admin.from('job_separations').select('*').order('id')).limit(1);
        return { data, error };
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // Dispatched figures and money totals are Admin-granted features. The
  // dispatch ledger doesn't depend on the rows, so it loads alongside them.
  const perms = await getDeptPermissions(deptKeyOf(user));
  const dispatchedPromise = canDeptSeeDispatchedQty(perms) ? dispatchedPerLine() : null;
  dispatchedPromise?.catch(() => {}); // reported below; never an unhandled rejection
  const cardsPromise = jobCardStates();

  // limit + 1 rows, to know whether more exist. PostgREST hands back at most
  // 1000 rows a request, so past that it is read in slices — one request used
  // to stop at 1000 and report "no more" with rows still unread. `id` breaks
  // created_at ties so slices never overlap.
  const SLICE = 1000;
  const all: { id: string }[] = [];
  for (let from = 0; from <= limit; from += SLICE) {
    const { data, error } = await applyFilters(
      admin.from('job_separations').select('*').order('created_at', { ascending: false }).order('id'),
    ).range(from, Math.min(from + SLICE - 1, limit));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    all.push(...(data ?? []));
    if ((data?.length ?? 0) < SLICE) break;
  }
  const hasMore = all.length > limit;
  const page = hasMore ? all.slice(0, limit) : all;
  const rows = canDeptSeePrices(perms) ? page : page.map((r) => ({ ...r, rate: null, order_value: null }));

  try {
    // The page shows one total for everything that matches. When it all fits
    // on the page the browser adds it up; otherwise only the order values of
    // the live (not cancelled) rows are read here — a few bytes a row.
    let totalOrderValue: number | undefined;
    if (hasMore && canDeptSeeMoneyTotals(perms)) {
      const values = await allPages<{ order_value: number | null }>((from, to) => applyFilters(
        admin.from('job_separations').select('order_value').is('cancelled_at', null).order('id').range(from, to),
      ));
      totalOrderValue = values.reduce((sum, r) => sum + (Number(r.order_value) || 0), 0);
    }

    const cards = await cardsPromise;
    const marked = cards ? rows.map((r) => ({ ...r, job_card: cards.get(r.id) ?? 'none' })) : rows;
    if (!rows.length || !dispatchedPromise) {
      return NextResponse.json({ job_separations: marked, hasMore, totalOrderValue });
    }
    const dispatched = await dispatchedPromise;
    return NextResponse.json({
      job_separations: marked.map((r) => ({ ...r, dispatched: dispatched.get(r.id) ?? null })),
      hasMore,
      totalOrderValue,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// Each line's job card state. Null when it can't be read: the worksheet still
// opens, its cards unmarked, rather than every line wrongly shown red.
// ponytail: reads every card's state per request (a few hundred a month);
// filter by the page's lines past ~20k cards.
async function jobCardStates(): Promise<Map<string, JobCardState> | null> {
  try {
    const admin = createAdminClient();
    const cards = await allPages<CardStateRow & { job_separation_id: string }>((from, to) => admin.from('job_cards')
      .select('job_separation_id, card_number, issued_at, edited:details->>edited').not('job_separation_id', 'is', null).order('id').range(from, to));
    const byLine = new Map<string, CardStateRow[]>();
    for (const c of cards) byLine.set(c.job_separation_id, [...(byLine.get(c.job_separation_id) ?? []), c]);
    return new Map(Array.from(byLine, ([id, list]) => [id, lineCardState(list)]));
  } catch (err) {
    console.error('[GET /api/job-separations] job card states', err);
    return null;
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageJobSeparation(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add job separation rows' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const party = text(body.party);
  if (!party) {
    return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  }

  // Required now, not just recorded: the DB trigger files the Sr. No.
  // under the PO's own month, so a row with no PO Date has nothing to
  // key its series on.
  const poDate = text(body.po_date);
  if (!poDate) {
    return NextResponse.json({ error: 'PO Date is required' }, { status: 400 });
  }
  if (!isIsoDate(poDate)) {
    return NextResponse.json({ error: 'PO Date is not a valid date' }, { status: 400 });
  }

  // A caller may pin an explicit Sr. No. (e.g. correcting an import); blank
  // means "let the database trigger auto-assign one".
  const srNo = text(body.sr_no);

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('job_separations')
    .insert({
      sr_no:          srNo,
      party,
      po_no:          text(body.po_no),
      po_date:        poDate,
      pm_code:        text(body.pm_code),
      material_name:  text(body.material_name),
      quantity:       integer(body.quantity),
      unit:           text(body.unit),
      job_status:     text(body.job_status),
      rate:           decimal(body.rate),
      jc_status:      text(body.jc_status),
      aw_send_to:     text(body.aw_send_to),
      created_by:     user.email ?? perms.key,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Sr. No. ${srNo} is already on another row` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ job_separation: data }, { status: 201 });
}
