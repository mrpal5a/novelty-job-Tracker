'use client';
// src/hooks/usePmCodeLookup.ts
// PM code → the newest Job Separation line with exactly that code. The
// worksheet already knows the party, material, unit and rate for a code the
// shop has seen before, so a form can fill them instead of having them retyped.
//
// Returns null while there is nothing to look up, 'none' when the code isn't
// on the worksheet, or the line. `onMatch` runs once per new match.

import { useEffect, useRef, useState } from 'react';
import type { JobSeparation } from '@/lib/types';

export function usePmCodeLookup(
  pmCode: string,
  enabled: boolean,
  onMatch: (row: JobSeparation) => void,
): JobSeparation | 'none' | null {
  const [match, setMatch] = useState<JobSeparation | 'none' | null>(null);
  const onMatchRef = useRef(onMatch);
  onMatchRef.current = onMatch;

  useEffect(() => {
    if (!enabled) return;
    const code = pmCode.trim();
    if (code.length < 3) {
      setMatch(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ field: 'pm_code', search: code, range: 'all', limit: '20' });
        const res = await fetch(`/api/job-separations?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const rows: JobSeparation[] = (await res.json()).job_separations ?? [];
        if (cancelled) return;
        const row = pickNewestExact(rows, code);
        setMatch(row ?? 'none');
        if (row) onMatchRef.current(row);
      } catch {
        // Best-effort: the fields can still be typed by hand.
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pmCode, enabled]);

  return match;
}

// The search is a substring match, newest first: take the newest row whose
// code is exactly this one ("PM-45" must not fill from "PM-450"), preferring
// one that wasn't cancelled.
export function pickNewestExact(rows: JobSeparation[], code: string): JobSeparation | undefined {
  const want = code.trim().toLowerCase();
  const exact = rows.filter((r) => r.pm_code?.trim().toLowerCase() === want);
  return exact.find((r) => !r.cancelled_at) ?? exact[0];
}

// A filled value replaces the field only while the field is empty or still
// holds the previous fill — something typed by hand is never overwritten.
export function fillIfUntouched(current: string, previousFill: string, next: string): string {
  return !current.trim() || current === previousFill ? next : current;
}
