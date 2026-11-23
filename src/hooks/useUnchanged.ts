// src/hooks/useUnchanged.ts
// An edit form saved without a change shouldn't reach the server: the
// UPDATE rewrites the row anyway, moves its updated_at, and bumps the
// table's data version, so every open list re-downloads (migration 075).
//
// Pass the values the form would send, built the same way at render. They
// are remembered as the form opens; `unchanged` stays true while they still
// match. `markSaved` moves the baseline, for a form that stays open after
// saving (settings pages).

import { useRef } from 'react';

export const NOTHING_CHANGED = 'Nothing changed';

export function useUnchanged(values: unknown) {
  const json = JSON.stringify(values);
  const saved = useRef(json);
  return {
    unchanged: json === saved.current,
    markSaved: () => { saved.current = json; },
  };
}
