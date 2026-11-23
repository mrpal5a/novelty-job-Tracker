// src/hooks/useExitGhost.ts
// Lets a menu, panel or dialog ease out as it closes, whatever closed it
// (Cancel, Save, Escape, a tap outside, a navigation) and without its parent
// keeping it mounted. As React removes the element, a frozen copy takes its
// place for the length of the exit animation, then goes. The copy is inert
// and hidden from screen readers, so nothing can be clicked or read twice.
//
// Give it the element's own component, so both come and go together; for a
// block shown with `{open && …}` inside a longer-lived component, wrap it in
// <Exiting> (components/ui/Exiting.tsx).
//
// The animation itself is CSS: the copy gets `anim-out`, which flips each
// `anim-*` enter class inside it to its exit (globals.css, "In and out").

import { useLayoutEffect, type RefObject } from 'react';

const EXIT_MS = 200;

export function useExitGhost(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    return () => {
      // Still in the page here: copy now, while it has its content.
      const parent = el.parentNode;
      if (!parent || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const next = el.nextSibling;
      const ghost = el.cloneNode(true) as HTMLElement;
      // Typed values live on the elements, not in the markup the copy is made from.
      const live = el.querySelectorAll<HTMLInputElement>('input, textarea, select');
      ghost.querySelectorAll<HTMLInputElement>('input, textarea, select').forEach((g, i) => { g.value = live[i]?.value ?? g.value; });
      ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      ghost.removeAttribute('id');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.inert = true;
      ghost.classList.add('anim-out');
      const orig = [el, ...Array.from(el.querySelectorAll<HTMLElement>('*'))];
      const scrolled = orig.flatMap((n, i) => (n.scrollTop > 0 ? [[i, n.scrollTop] as const] : []));

      // React (Strict Mode in dev) also runs this when it only re-mounts: then
      // the element is still in the page a moment later, and no copy is needed.
      queueMicrotask(() => {
        if (el.isConnected || !parent.isConnected) return;
        parent.insertBefore(ghost, next && next.parentNode === parent ? next : null);
        // Keep a scrolled list where it was rather than jumping to its top.
        const copies = [ghost, ...Array.from(ghost.querySelectorAll<HTMLElement>('*'))];
        for (const [i, top] of scrolled) if (copies[i]) copies[i].scrollTop = top;
        setTimeout(() => ghost.remove(), EXIT_MS + 20);
      });
    };
  }, [ref]);
}
