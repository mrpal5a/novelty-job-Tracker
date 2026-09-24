'use client';
// src/hooks/useFitToViewport.ts
// Makes a scroll container end exactly at the bottom of the window, so the
// TABLE scrolls and the page doesn't. A fixed `max-h-[70vh]` can't do this:
// how much room is left depends on everything above the table (header,
// tabs, toolbar, totals), which differs per page and per screen height.
//
// Measures where the element starts and sets its max-height to the space
// left below it, minus `bottomGap` (the admin <main>'s bottom padding).
// Re-fits on window resize and whenever the page's layout shifts (content
// above it appearing or wrapping). Never shrinks below `min`, so on a very
// short screen the page scrolls a little rather than the table vanishing.
//
// Returns a callback ref — works for containers that mount after loading.

import { useLayoutEffect, useState } from 'react';

export function useFitToViewport<T extends HTMLElement>(bottomGap = 24, min = 260) {
  const [el, setEl] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const room = Math.floor(window.innerHeight - top - bottomGap);
      el.style.maxHeight = `${Math.max(min, room)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(document.body);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [el, bottomGap, min]);

  return setEl;
}
