'use client';
// src/hooks/useUrlSearch.ts
// Lets a page open with its search box already filled: /admin/plates?q=PM-204
// sets the plates search to "PM-204". The Ctrl K palette links this way, so
// picking a plate lands on the Plates page showing that plate.
//
// On pages with size boxes, a size typed as one value ("210x60") fills the
// two boxes instead of the search box.
//
// ?field=location picks the search field too (Ctrl K does this for a rack
// number, so "437" opens on the plates AT rack 437). Without it the field
// goes back to "All fields".
//
// It follows the URL rather than reading it once, because the palette can
// send you to the page you're already on with a different ?q=, and that
// navigation keeps the component mounted.

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { parseSizePair } from '@/lib/search';

export function useUrlSearch(
  setSearch: (q: string) => void,
  onFound?: (q: string) => void,
  setSizes?: (pair: [string, string]) => void,
  setField?: (field: string) => void,
) {
  const params = useSearchParams();
  const q = params.get('q');
  const field = params.get('field');
  useEffect(() => {
    if (q === null) return;
    setField?.(field ?? 'all');
    const pair = setSizes && parseSizePair(q);
    if (pair) { setSearch(''); setSizes(pair); } else setSearch(q);
    onFound?.(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the URL only
  }, [q, field]);
}
