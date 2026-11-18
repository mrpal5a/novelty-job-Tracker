'use client';
// src/hooks/useUrlSearch.ts
// Lets a page open with its search box already filled: /admin/plates?q=PM-204
// sets the plates search to "PM-204". The Ctrl K palette links this way, so
// picking a plate lands on the Plates page showing that plate.
//
// On pages with size boxes, a size typed as one value ("210x60") fills the
// two boxes instead of the search box.
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
) {
  const q = useSearchParams().get('q');
  useEffect(() => {
    if (q === null) return;
    const pair = setSizes && parseSizePair(q);
    if (pair) { setSearch(''); setSizes(pair); } else setSearch(q);
    onFound?.(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to the URL only
  }, [q]);
}
