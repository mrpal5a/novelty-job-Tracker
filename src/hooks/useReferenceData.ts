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

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MentionOption } from '@/lib/mentionInput';
import type { Party } from '@/lib/types';

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

export const PARTIES_KEY = ['parties'] as const;

/** The party list (~55 names), for suggesting as people type: matched in the
 *  browser (findParties), so suggestions follow each key. Default staleTime,
 *  not the long one above: a party Prepress has just added must show up the
 *  next time a form opens. Managing parties refreshes it (ManagePartiesModal). */
export function useParties() {
  return useQuery({
    queryKey: PARTIES_KEY,
    queryFn:  () => getJson('/api/parties', (b) => (b.parties ?? []) as Party[]),
  });
}

export const TEAM_DIRECTORY_KEY = ['team', 'directory'] as const;

export type DirectoryPerson = { id: string; email: string; username: string; department: string | null; joined_at?: string };
type Directory = { people: DirectoryPerson[]; departments: { key: string; display_name: string }[] };

/**
 * Every login's @username and department, plus the department tags — from
 * GET /api/team/directory, open to any signed-in user. `byEmail` turns the
 * email stored on a note or message into the username to show beside it;
 * `options` is what the @ popup offers, people before departments.
 */
export function useTeamDirectory() {
  const q = useQuery({
    queryKey: TEAM_DIRECTORY_KEY,
    queryFn:  () => getJson<Directory>('/api/team/directory', (b) => ({
      people:      (b.people ?? []) as Directory['people'],
      departments: (b.departments ?? []) as Directory['departments'],
    })),
    staleTime: REFERENCE_STALE_MS,
  });
  const data = q.data;
  return useMemo(() => {
    const people = data?.people ?? [];
    const departments = data?.departments ?? [];
    const deptName = new Map(departments.map((d) => [d.key, d.display_name]));
    const byEmail = new Map(people.filter((p) => p.email).map((p) => [p.email.toLowerCase(), p]));
    const options: MentionOption[] = [
      ...people.map((p) => ({ handle: p.username, hint: (p.department && deptName.get(p.department)) || 'No department', kind: 'person' as const })),
      ...departments.map((d) => ({ handle: d.key, hint: `${d.display_name} · whole department`, kind: 'department' as const })),
    ];
    /** "@ravi" for a known email, else the part before the @. */
    const nameOf = (email: string | null | undefined) =>
      (email && byEmail.get(email.toLowerCase())?.username) || (email ?? '').replace(/@.*/, '');
    return { people, departments, byEmail, options, nameOf, isLoading: q.isLoading };
  }, [data, q.isLoading]);
}

export const MATERIALS_KEY = ['materials'] as const;

/** Prepress's material list (Plates → Materials): what every Material field
 *  picks from. Not BOM's list, which carries rates. Default staleTime so a
 *  material just added shows up the next time a form opens. */
export function useMaterials() {
  return useQuery({
    queryKey: MATERIALS_KEY,
    queryFn:  () => getJson('/api/materials', (b) => (b.materials ?? []) as { id: string; name: string }[]),
  });
}
