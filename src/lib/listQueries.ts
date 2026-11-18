// src/lib/listQueries.ts
// The request behind each big list page — its cache key and its fetch — in
// one place, so the page and the menu ask for exactly the same thing. The
// menu calls these with no arguments when the pointer reaches a link
// (AdminHeader), so the list is already in memory when the page opens.
//
// The defaults here ARE each page's opening state. A page that starts on a
// different search, sort or range than these simply misses the warm-up.

import type { QueryFunctionContext } from '@tanstack/react-query';
import type { JobSeparation, Plate, Die, FlatbedDie, ShadeCard } from '@/lib/types';

async function getJson(url: string, signal: AbortSignal, fallback: string) {
  const res  = await fetch(url, { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? fallback);
  return data;
}

// ── Job Separation ─────────────────────────────────────────────
export const JOB_SEPARATION_PAGE_SIZE = 100;
export type JobSeparationList = { rows: JobSeparation[]; hasMore: boolean; totalOrderValue: number | null };

export function jobSeparationListQuery({
  search = '', field = 'all', range = 'month', party = '', limit = JOB_SEPARATION_PAGE_SIZE,
}: { search?: string; field?: string; range?: string; party?: string; limit?: number } = {}) {
  return {
    queryKey: ['job-separations', search, field, range, party, limit] as const,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<JobSeparationList> => {
      const params = new URLSearchParams({ range, limit: String(limit) });
      if (search) {
        params.set('search', search);
        if (field !== 'all') params.set('field', field);
      }
      if (party) params.set('party', party);
      const data = await getJson(`/api/job-separations?${params}`, signal, 'Failed to load job separation rows');
      return {
        rows:    (data.job_separations ?? []) as JobSeparation[],
        hasMore: Boolean(data.hasMore),
        // Sent only when more rows match than are loaded (and the dept may see money).
        totalOrderValue: typeof data.totalOrderValue === 'number' ? data.totalOrderValue : null,
      };
    },
  };
}

// ── Plates ─────────────────────────────────────────────────────
export const PLATE_PAGE_SIZE = 100;
export type PlateList = { plates: Plate[]; total: number };

/** Search + sort only — shared with the CSV export, which adds `all=1`. */
export function plateListParams({ search = '', field = 'all', sort = 'created_at', dir = 'desc', sizeA = '', sizeB = '' }: {
  search?: string; field?: string; sort?: string; dir?: string; sizeA?: string; sizeB?: string;
} = {}): URLSearchParams {
  const params = new URLSearchParams({ sort, dir });
  if (search) {
    params.set('search', search);
    if (field !== 'all') params.set('field', field);
  }
  setSizePair(params, sizeA, sizeB);
  return params;
}

/** The two size boxes beside a search (see orSizePair). */
function setSizePair(params: URLSearchParams, sizeA: string, sizeB: string) {
  if (sizeA) params.set('size_a', sizeA);
  if (sizeB) params.set('size_b', sizeB);
}

export function plateListQuery({
  search = '', field = 'all', sort = 'created_at', dir = 'desc', sizeA = '', sizeB = '', limit = PLATE_PAGE_SIZE,
}: { search?: string; field?: string; sort?: string; dir?: string; sizeA?: string; sizeB?: string; limit?: number } = {}) {
  return {
    queryKey: ['plates', search, field, sort, dir, sizeA, sizeB, limit] as const,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<PlateList> => {
      const params = plateListParams({ search, field, sort, dir, sizeA, sizeB });
      params.set('limit', String(limit));
      const data = await getJson(`/api/plates?${params}`, signal, 'Failed to load plates');
      return { plates: (data.plates ?? []) as Plate[], total: Number(data.total) || 0 };
    },
  };
}

// ── Dies ───────────────────────────────────────────────────────
// Every roto die (~1,000). The Dies page, a plate's matching dies and the
// add-die duplicate check all share this one download; the page searches
// it in the browser (src/lib/dieSearch.ts).
export function dieListQuery() {
  return {
    queryKey: ['dies'] as const,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<Die[]> => {
      const data = await getJson('/api/dies', signal, 'Failed to load dies');
      return (data.dies ?? []) as Die[];
    },
  };
}

// The whole flatbed library (~70 dies), searched the same way.
export function flatbedDieListQuery() {
  return {
    queryKey: ['flatbed-dies'] as const,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<FlatbedDie[]> => {
      const data = await getJson('/api/flatbed-dies', signal, 'Failed to load flatbed dies');
      return (data.flatbed_dies ?? []) as FlatbedDie[];
    },
  };
}

// ── Shade Cards ────────────────────────────────────────────────
export type ShadeCardList = { cards: ShadeCard[]; total: number; page: number; pageSize: number };

/** Everything but the page — shared with the CSV export, which adds `export=1`. */
export function shadeCardListParams({ search = '', field = 'all', status = '', createdFrom = null, sort = 'shade_card_number', dir = 'asc' }: {
  search?: string; field?: string; status?: string; createdFrom?: string | null; sort?: string; dir?: string;
} = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (search && field !== 'all') params.set('field', field);
  if (status) params.set('status', status);
  if (createdFrom) params.set('created_from', createdFrom);
  params.set('sort', sort);
  params.set('dir', dir);
  return params;
}

export function shadeCardListQuery({
  search = '', field = 'all', filter = 'all', status = '', createdFrom = null,
  page = 1, sort = 'shade_card_number', dir = 'asc',
}: {
  search?: string; field?: string; filter?: string; status?: string;
  /** The "last 7 days" cutoff; null unless that filter is on. */
  createdFrom?: string | null;
  page?: number; sort?: string; dir?: string;
} = {}) {
  return {
    // The 7-day cutoff is part of the key only while that filter is on: it
    // moves every time the tiles refresh.
    queryKey: ['shade-cards', search, field, filter, createdFrom, page, sort, dir] as const,
    queryFn: async ({ signal }: QueryFunctionContext): Promise<ShadeCardList> => {
      const params = shadeCardListParams({ search, field, status, createdFrom, sort, dir });
      params.set('page', String(page));
      return getJson(`/api/shade-cards?${params}`, signal, 'Failed to load shade cards');
    },
  };
}

// ── Warm-up from the menu ──────────────────────────────────────
/** The opening list for a page, by its menu href. */
export const LIST_WARMUP: Record<string, () => { queryKey: readonly unknown[]; queryFn: (ctx: QueryFunctionContext) => Promise<unknown> }> = {
  '/admin/job-separation': () => jobSeparationListQuery(),
  '/admin/plates':         () => plateListQuery(),
  '/admin/dies':           () => dieListQuery(),
  '/admin/shade-cards':    () => shadeCardListQuery(),
};
