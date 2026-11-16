// src/hooks/useIsDesk.ts
// True when the window is at least `minWidth` px wide (default: Tailwind's
// `sm`). The list pages have a phone card list and a desk table; building
// both and hiding one with CSS draws every row twice, so they render only
// the one that fits. The server can't know the width and assumes desk —
// rows only arrive in the browser anyway.
import { useCallback, useSyncExternalStore } from 'react';

export function useIsDesk(minWidth = 640): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const subscribe = useCallback((onChange: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => true);
}
