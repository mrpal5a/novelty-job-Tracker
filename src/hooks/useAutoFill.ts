// src/hooks/useAutoFill.ts
// Keeps a form box equal to a worked-out value (label per round, width gap)
// while nobody has typed over it: only its own fill is replaced, so a value
// typed by hand stays, and clearing the box hands it back. Seeded with the
// sum of the saved values, so a record whose box matched still follows edits.

import { useEffect, useRef } from 'react';

export function useAutoFill(auto: number | null, value: string, set: (next: string) => void) {
  const now = useRef(value);
  now.current = value;
  const setNow = useRef(set);
  setNow.current = set;
  const last = useRef(String(auto ?? ''));
  useEffect(() => {
    const next = auto === null ? '' : String(auto);
    const current = now.current;
    if ((current.trim() && current !== last.current) || current === next) return;
    last.current = next;
    setNow.current(next);
  }, [auto]);
}
