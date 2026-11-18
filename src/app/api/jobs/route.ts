// src/app/api/jobs/route.ts
// ============================================================
// GET  /api/jobs  — list all active jobs (sorted by delivery_date ASC)
// POST /api/jobs  — create a new job + optional dispatch schedule rows
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions } from '@/lib/constants/departments';
import { createJobRecord } from '@/lib/jobs/createJob';
import type { AddJobFormData } from '@/lib/types';
import { onSearchText, orContains, searchAsPhrase, searchTerms } from '@/lib/search';
import { deptKeyOf } from '@/lib/identity';

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Verify authenticated
  const user = await getClaimsUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status    = searchParams.get('status');
  const urgent    = searchParams.get('urgent');
  const search    = searchParams.get('search');
  const closed    = searchParams.get('closed') === 'true';

  // job_card_number first: prepress reads a number off a printed card and
  // searches for it, so it is the most common lookup on the floor. pm_code:
  // the slip page searches by PM code (src/lib/slipSource.ts). Matched on
  // search_text (migration 099) — see searchAsPhrase for phrase vs words.
  const terms = search ? searchTerms(search) : null;
  let asPhrase = true;
  if (terms) {
    try {
      // The phrase, over the same view (open or closed, status, urgent).
      asPhrase = await searchAsPhrase(terms, async () => {
        let probe = supabase.from('jobs').select('*').eq('is_closed', closed);
        if (status) probe = probe.eq('status', status);
        if (urgent === 'true') probe = probe.eq('urgent', true);
        const { data, error } = await onSearchText(probe, terms, true).limit(1);
        return { data, error };
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  let query = supabase
    .from('jobs')
    .select('*, job_stage_timestamps(stage), printing_units(id, name, printing_method), job_separations(rate, unit, material_name)')
    .eq('is_closed', closed)
    .order('delivery_date', { ascending: true, nullsFirst: false });
  if (status) query = query.eq('status', status);
  if (urgent === 'true') query = query.eq('urgent', true);
  if (terms) query = onSearchText(query, terms, asPhrase);
  // Only punctuation typed ("%"): matched as typed.
  else if (search) query = query.or(orContains(['job_card_number', 'po_number', 'party', 'job_name', 'pm_code'], search));

  const { data, error } = await query;

  if (error) {
    console.error('[GET /api/jobs]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ jobs: data });
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  // Verify authenticated + get department
  const user = await getClaimsUser(supabase);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) {
    return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });
  }

  const body: AddJobFormData = await request.json();

  // Use admin client to bypass RLS for insert — we've already verified auth above
  const admin = createAdminClient();

  const result = await createJobRecord(admin, perms.key, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ job: result.job }, { status: 201 });
}
