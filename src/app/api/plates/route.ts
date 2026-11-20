// src/app/api/plates/route.ts
// ============================================================
// GET  /api/plates  — the plate list (any authenticated user)
// POST /api/plates  — record a plate (Prepress or Admin)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { createAdminClient } from '@/lib/supabase/admin';
import { getDeptPermissions, canDeptManageDiesPlates } from '@/lib/constants/departments';
import { containsPattern, escapeLike, onSearchText, orContains, orMatch, orSizePair, searchAsPhrase, searchTerms } from '@/lib/search';
import { deptKeyOf } from '@/lib/identity';
import { allPages } from '@/lib/api/allPages';
import { layoutFrom } from '@/lib/plateDie';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// Field-scoped search: a whitelist, not a raw column name from the query
// string, so a request can never point .ilike() at an arbitrary column.
// Integer columns can't take .ilike() — Postgres has no ILIKE for integer
// and PostgREST/supabase-js does not apply a `column::text` cast through
// the filter builder (confirmed: it raises "operator does not exist:
// integer ~~* unknown") — so those match on the exact number instead.
type PlateSearchField = { column: string; type: 'text' | 'size' | 'int' | 'exact' };

const PLATE_SEARCH_FIELDS: Record<string, PlateSearchField> = {
  party:           { column: 'party',           type: 'text' },
  plate_id:        { column: 'plate_id',        type: 'text' },
  pm_code:         { column: 'pm_code',         type: 'text' },
  // The whole code, any case: a Job Separation line's plates (its metres).
  pm_code_exact:   { column: 'pm_code',         type: 'exact' },
  item_name:       { column: 'item_name',       type: 'text' },
  location:        { column: 'location',        type: 'text' },
  // One "Size" option, as on dies: a number read off either side of the plate.
  size:            { column: 'size',            type: 'size' },
  cylinder:        { column: 'cylinder',        type: 'int' },
  label_per_round: { column: 'label_per_round', type: 'int' },
};

// Columns a header click may sort by — a whitelist, never a raw query value.
const PLATE_SORT_COLUMNS = new Set([
  'plate_id', 'party', 'pm_code', 'item_name', 'across_size', 'cylinder',
  'label_per_round', 'location', 'plate_date', 'created_at',
]);

// ── GET ───────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const search = searchParams.get('search')?.trim();
  const field  = searchParams.get('field')?.trim();
  // The two size boxes beside the search — both sizes at once, ANDed with it.
  const sizeA  = searchParams.get('size_a')?.trim() ?? '';
  const sizeB  = searchParams.get('size_b')?.trim() ?? '';

  const config = search && field ? PLATE_SEARCH_FIELDS[field] : undefined;
  // Not a whole number — an integer column can't contain it, so the
  // answer is "no matches" rather than a query error.
  if (search && config?.type === 'int' && !Number.isFinite(Number(search))) {
    return NextResponse.json({ plates: [] });
  }

  // "All fields" reads search_text (migration 099); see searchAsPhrase.
  const terms = search && !config ? searchTerms(search) : null;
  let asPhrase = true;

  // Thousands of plates since the Plates.xlsx import: page past PostgREST's
  // 1000-row cap. id breaks created_at ties so pages never overlap.
  // One page at a time, sorted here: the whole table is ~4,000 plates and
  // 1.8 MB, far too much to send on every load and search. `total` is how
  // many match, for "showing X of Y". ?all=1 is the CSV export.
  const sort = PLATE_SORT_COLUMNS.has(searchParams.get('sort') ?? '') ? searchParams.get('sort')! : 'created_at';
  const ascending = searchParams.get('dir') === 'asc';
  const rawLimit = Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.trunc(rawLimit), 1000) : 100;

  // Blank values sort last going up and first going down, as the page did
  // when it sorted in the browser. `id` breaks ties so pages don't shuffle.
  const sorted = (from: number, to: number, count?: 'exact') => {
    let query = supabase.from('plates').select('*', count ? { count } : undefined);
    if (search) {
      if (config?.type === 'int') query = query.eq(config.column, Math.trunc(Number(search)));
      // Size matches across or around on the whole millimetre: "60" finds 60
      // and 60.5, not 160 or 600.
      else if (config?.type === 'size') query = query.or(orMatch([], ['across_size', 'around_size'], search));
      else if (config?.type === 'exact') query = query.ilike(config.column, escapeLike(search));
      else if (config) query = query.ilike(config.column, containsPattern(search));
      else if (terms) query = onSearchText(query, terms, asPhrase);
      // Only punctuation typed ("%"): matched as typed.
      else query = query.or(orContains(['party', 'pm_code', 'item_name', 'plate_id'], search));
    }
    if (sizeA || sizeB) query = query.or(orSizePair(['across_size', 'around_size'], sizeA, sizeB));
    return query.order(sort, { ascending, nullsFirst: !ascending }).order('id').range(from, to);
  };

  try {
    // The phrase over the same filters (size boxes too), one row.
    if (terms) asPhrase = await searchAsPhrase(terms, () => sorted(0, 0));
    if (searchParams.get('all') === '1') {
      return NextResponse.json({ plates: await allPages((from, to) => sorted(from, to)) });
    }
    const { data, error, count } = await sorted(0, limit - 1, 'exact');
    if (error) throw new Error(error.message);
    return NextResponse.json({ plates: data ?? [], total: count ?? data?.length ?? 0 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient();

  const user = await getClaimsUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return NextResponse.json({ error: 'Invalid department' }, { status: 403 });

  if (!canDeptManageDiesPlates(perms)) {
    return NextResponse.json(
      { error: 'Only Prepress or Admin can add plates' },
      { status: 403 }
    );
  }

  const body = await request.json();

  const party = typeof body.party === 'string' ? body.party.trim() : '';
  if (!party) {
    return NextResponse.json({ error: 'Party is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('plates')
    .insert({
      party,
      pm_code:         optionalText(body.pm_code),
      item_name:       optionalText(body.item_name),
      across_size:     optionalText(body.across_size),
      around_size:     optionalText(body.around_size),
      cylinder:        optionalInt(body.cylinder),
      plate_id:        optionalText(body.plate_id),
      plate_date:      optionalText(body.plate_date),
      label_per_round: optionalInt(body.label_per_round),
      location:        optionalText(body.location),
      die_id:          optionalText(body.die_id),
      total_colors:    optionalInt(body.total_colors),
      ...layoutFrom(body),
      created_by:      user.email ?? perms.key,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ plate: data }, { status: 201 });
}
