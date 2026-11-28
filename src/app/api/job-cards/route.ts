// src/app/api/job-cards/route.ts
// ============================================================
// GET  /api/job-cards — every job card, newest first, searched as the other
//      lists are. Drafts only for departments that make cards.
// POST /api/job-cards — start a card by hand, for a job that isn't in Job
//      Separation: { manual: { job_name, number, party, … } }. job_card_edit.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { jobCardDbError, jobCardWriter } from '@/lib/api/jobCardSources';
import { JOB_CARD_LIST, jobCardFrom } from '@/lib/jobCard';
import { onSearchText, orContains, searchAsPhrase, searchTerms } from '@/lib/search';

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const search = params.get('search')?.trim() ?? '';
  const only = params.get('only');
  const rawLimit = Number(params.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 1000) : 100;
  const terms = search ? searchTerms(search) : null;
  let asPhrase = true;

  const list = (to: number, count?: 'exact') => {
    let query = supabase.from('job_cards').select(JOB_CARD_LIST, count ? { count } : undefined);
    if (!canDeptEditJobCards(perms)) query = query.not('issued_at', 'is', null);
    if (only === 'manual') query = query.not('manual', 'is', null);
    // Not those of a cancelled order: they can't be issued or accepted any more.
    const live = (q: typeof query) => q.is('job_separations.cancelled_at', null).or('job_separation_id.is.null,job_separations.not.is.null');
    if (only === 'waiting') query = live(query.not('issued_at', 'is', null).is('accepted_at', null).is('edit_request', null));
    if (only === 'asked') query = live(query.not('edit_request', 'is', null));
    if (only === 'draft') query = live(query.is('issued_at', null));
    if (terms) query = onSearchText(query, terms, asPhrase);
    else if (search) query = query.or(orContains(['card_number', 'party', 'job_name', 'pm_code', 'po_no'], search));
    return query.order('created_at', { ascending: false }).order('id').range(0, to);
  };
  try {
    if (terms) asPhrase = await searchAsPhrase(terms, () => list(0));
    const { data, error, count } = await list(limit - 1, 'exact');
    if (error) throw error;
    return NextResponse.json({ cards: data ?? [], total: count ?? data?.length ?? 0 });
  } catch (e) {
    console.error('[GET /api/job-cards]', e);
    return NextResponse.json({ error: 'Failed to load job cards' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const writer = await jobCardWriter();
  if ('denied' in writer) return writer.denied;

  const body = await request.json().catch(() => null);
  const parsed = jobCardFrom(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { manual } = parsed.columns;
  if (!manual) return NextResponse.json({ error: 'Type the order details' }, { status: 400 });
  if (!manual.job_name) return NextResponse.json({ error: 'Enter the job name' }, { status: 400 });

  const { data, error } = await createAdminClient().from('job_cards')
    .insert({ ...parsed.columns, part: 0, created_by: writer.name }).select().single();
  if (error) return jobCardDbError(error);
  return NextResponse.json({ card: data }, { status: 201 });
}
