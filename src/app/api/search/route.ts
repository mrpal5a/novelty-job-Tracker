// src/app/api/search/route.ts
// ============================================================
// GET /api/search?q=riverline — the Ctrl K palette's "search everything".
// ============================================================
//
// One request, eight small lists: jobs, Job Separation lines, shade cards,
// plates, roto and flatbed dies, label stock on the shelf, and parties. Each
// is capped, because the palette is for jumping to a thing, not browsing —
// the page it opens has the full list.
//
// Same visibility as each section's own GET: jobs, Job Separation, shade
// cards, plates, dies and parties are open to any signed-in user; label
// stock only to departments that can see stock (and RLS on label_stock
// enforces that again).

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptViewStock } from '@/lib/constants/departments';
import { containsPattern, exactFieldPattern, onSearchText, orContains, orMatch, orSizePair, parseSizePair, searchTerms } from '@/lib/search';
import { SHADE_CARD_SEARCH_COLUMNS } from '@/lib/constants/shadeCards';
import { deptKeyOf } from '@/lib/identity';

const LIMIT = 5;

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  // One letter matches half the database; wait for something specific.
  if (q.length < 2) {
    return NextResponse.json({ jobs: [], separations: [], shadeCards: [], plates: [], dies: [], flatbed: [], stock: [], parties: [] });
  }

  const perms = await getDeptPermissions(deptKeyOf(user));
  const canSeeStock = canDeptViewStock(perms);

  // "210x60" is a size: dies and plates are matched on it either way round
  // (as the size boxes on their pages do). A lone number also matches die
  // sizes, as each die page's "All fields" search does.
  const pair = parseSizePair(q);
  const dieMatch = (contains: string[]) =>
    pair ? orSizePair(['length', 'width'], pair[0], pair[1]) : orMatch(contains, ['length', 'width'], q);

  // Job Separation lines on search_text (migration 098), best first: a
  // field that IS the text ("203232" is that PM code), then the text inside
  // a field, then — for several words — each word somewhere in the line.
  // Within each, live lines then the newest. No money columns: not every
  // dept may see them.
  const terms = searchTerms(q);
  const separations = () => supabase
    .from('job_separations')
    .select('id, sr_no, party, po_no, pm_code, material_name, quantity, cancelled_at')
    .order('cancelled_at', { ascending: false, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  async function searchSeparations() {
    if (!terms) return separations().or(orContains(['sr_no', 'party', 'po_no', 'pm_code', 'material_name'], q));
    const tiers = await Promise.all([
      separations().ilike('search_text', exactFieldPattern(terms)),
      onSearchText(separations(), terms, true),
      terms.words.length > 1 ? onSearchText(separations(), terms, false) : null,
    ]);
    return bestFirst(tiers);
  }

  const [jobs, separationRows, shadeCards, plates, dies, flatbed, stock, parties] = await Promise.all([
    supabase
      .from('jobs')
      .select('id, job_card_number, po_number, party, job_name, pm_code, status, delivery_date, is_closed')
      .or(orContains(['job_card_number', 'po_number', 'party', 'job_name', 'pm_code'], q))
      // Open jobs first, then the newest — a repeat order beats last year's.
      .order('is_closed', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    // Job Separation lines — the most searched list in the app.
    searchSeparations(),
    // Shade cards: the live version of each card only, as on its page.
    supabase
      .from('shade_cards')
      .select('id, shade_card_number, party, product_name, pm_code, status')
      .eq('is_current', true)
      .or(orContains(SHADE_CARD_SEARCH_COLUMNS, q))
      .order('updated_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('plates')
      .select('id, plate_id, party, pm_code, item_name, cylinder, location, across_size, around_size')
      .or(pair ? orSizePair(['across_size', 'around_size'], pair[0], pair[1]) : orContains(['party', 'pm_code', 'item_name', 'plate_id'], q))
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('dies')
      .select('id, serial_no, job_name, length, width, status, location')
      .or(dieMatch(['job_name', 'serial_no', 'location']))
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('flatbed_dies')
      .select('id, serial_no, length, width, shape, location')
      .or(dieMatch(['location', 'shape']))
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    canSeeStock
      ? supabase
          .from('label_stock')
          .select('id, kind, party, job_name, pm_code, job_card_number, qty, location')
          .eq('is_dispatched', false)
          .or(orContains(['job_card_number', 'po_number', 'pm_code', 'party', 'job_name', 'location'], q))
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('parties')
      .select('id, name')
      .ilike('name', containsPattern(q))
      .order('name')
      .limit(LIMIT),
  ]);

  const failed = [jobs, separationRows, shadeCards, plates, dies, flatbed, stock, parties].find((r) => r.error);
  if (failed?.error) {
    console.error('[GET /api/search]', failed.error);
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({
    jobs:    jobs.data    ?? [],
    separations: separationRows.data ?? [],
    shadeCards:  shadeCards.data  ?? [],
    plates:  plates.data  ?? [],
    dies:    dies.data    ?? [],
    flatbed: flatbed.data ?? [],
    stock:   stock.data   ?? [],
    parties: parties.data ?? [],
  });
}

/** Merges result lists in order, each row once, capped at LIMIT. */
function bestFirst<T extends { id: string }, E>(tiers: ({ data: T[] | null; error: E | null } | null)[]) {
  const error = tiers.find((t) => t?.error)?.error ?? null;
  const seen = new Set<string>();
  const data = tiers.flatMap((t) => t?.data ?? []).filter((r) => !seen.has(r.id) && seen.add(r.id)).slice(0, LIMIT);
  return { data, error };
}
