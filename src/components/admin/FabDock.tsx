'use client';
// src/components/admin/FabDock.tsx
// Phones only: when a page adds floating tools (calculator, prepress to-do —
// tagged .fab-tool) beside Messages, their round buttons fold behind this one
// "+" so they don't cover the list. Tapping it fans them out above it; any
// tap after that folds them again. Which buttons show is all CSS (globals.css,
// "Floating button dock"), keyed off html[data-fab-open]; this only toggles it.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function FabDock() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    document.documentElement.toggleAttribute('data-fab-open', open);
    if (!open) return;
    // Any other tap — on a tool (after its own click opened it) or elsewhere — folds them.
    const onClick = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.fab-dock')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.documentElement.removeAttribute('data-fab-open');
    };
  }, [open]);

  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      aria-expanded={open}
      aria-label={open ? 'Hide tools' : 'Tools: calculator, to-do and messages'}
      className={cn(
        'fab-dock admin-fab fixed bottom-5 right-5 z-40 hidden h-14 w-14 items-center justify-center rounded-full',
        'bg-brand-primary text-white shadow-lg shadow-black/20 transition-colors hover:bg-brand-primary-hover',
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/40',
      )}
    >
      <Plus className={cn('h-6 w-6 transition-transform duration-200 ease-in-out motion-reduce:transition-none', open && 'rotate-45')} aria-hidden="true" />
      {/* Lit by CSS while a folded tool carries a count (unread, open to-dos). */}
      <span aria-hidden="true" className="fab-dock-dot absolute right-0.5 top-0.5 hidden h-3.5 w-3.5 rounded-full bg-amber-400 ring-2 ring-white" />
    </button>
  );
}
