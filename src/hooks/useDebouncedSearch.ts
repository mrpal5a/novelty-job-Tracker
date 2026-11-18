'use client';
// src/hooks/useDebouncedSearch.ts
// What a search box asks the server for: the text once typing pauses, so a
// word typed at speed is one request, not one per letter. Clearing the box
// applies at once. One delay for every server-backed search in the app.

import { useEffect, useState } from 'react';

/** Long enough to cover the gap between keys, short enough to feel instant. */
export const SEARCH_DEBOUNCE_MS = 200;

export function useDebouncedSearch(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), value ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}
