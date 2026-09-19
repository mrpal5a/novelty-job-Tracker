'use client';
// src/components/admin/SortableHeaderLabel.tsx
// A table header's plain label made clickable — click to sort by it, click
// again to flip direction. Looks exactly like a static header (same text, no
// permanent icon) except for the active column, which gets a small arrow.
// Extracted from the sortLabel() pattern in JobSeparationManager / DiesManager
// / FlatbedDiesManager so the remaining admin tables sort the same way
// without re-implementing the same button in each one.

import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortDir } from '@/lib/sort';

type Props = {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
};

export default function SortableHeaderLabel({ label, active, dir, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      className={cn(
        'inline-flex items-center gap-1 hover:text-[var(--glass-ink)] transition-colors',
        active && 'text-[var(--glass-ink)]',
      )}
    >
      {label}
      {active && (
        dir === 'asc'
          ? <ArrowUp className="w-3 h-3 shrink-0" aria-hidden="true" />
          : <ArrowDown className="w-3 h-3 shrink-0" aria-hidden="true" />
      )}
    </button>
  );
}
