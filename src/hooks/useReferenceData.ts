'use client';
// src/hooks/useReferenceData.ts
// Shared, cached reads for small reference lists that many components need.
//
// Each of these used to be fetched independently in a useEffect by every
// component that needed it — NotesFeed alone re-ran /api/departments (four
// DB queries) on every admin page load. Behind one React Query key, all
// callers share a single request and revisits render from cache.
//
// The lists change rarely and only from their own admin pages, which write
// the fresh list straight into the cache (see DepartmentsManager and
// PrintingUnitsManager), so a long staleTime is safe.

import { useQuery } from '@tanstack/react-query';

const REFERENCE_STALE_MS = 5 * 60_000;

export const DEPARTMENTS_KEY    = ['departments'] as const;
export const PRINTING_UNITS_KEY = ['printing-units'] as const;

async function getJson<T>(url: string, pick: (body: Record<string, unknown>) => T): Promise<T> {
  const res  = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Failed to load ${url}`);
  return pick(body);
}

/** Every department row, as returned by GET /api/departments. */
export function useDepartments<T = { key: string; display_name: string }>() {
  return useQuery({
    queryKey: DEPARTMENTS_KEY,
    queryFn:  () => getJson('/api/departments', (b) => (b.departments ?? []) as T[]),
    staleTime: REFERENCE_STALE_MS,
  });
}

/** Active printing units, as returned by GET /api/printing-units. */
export function usePrintingUnits<T>(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PRINTING_UNITS_KEY,
    queryFn:  () => getJson('/api/printing-units', (b) => (b.units ?? []) as T[]),
    staleTime: REFERENCE_STALE_MS,
    enabled:  opts.enabled ?? true,
  });
}
