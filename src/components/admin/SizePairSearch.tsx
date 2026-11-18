'use client';
// src/components/admin/SizePairSearch.tsx
// Two size boxes beside the plate and die searches: type both sides and only
// that size is listed (either way round, whole millimetre — orSizePair). They
// AND with the main search box, so "HEMANI" + 60 × 146 narrows to one job.

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useDebouncedSearch';

export type SizePair = [string, string];

/** The boxes' values, and the same values once typing pauses. */
export function useSizePair() {
  const [size, setSize] = useState<SizePair>(['', '']);
  const [debounced, setDebounced] = useState<SizePair>(['', '']);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced([size[0].trim(), size[1].trim()]), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [size]);
  return { size, setSize, debounced, active: Boolean(size[0].trim() || size[1].trim()) };
}

export default function SizePairSearch({ value, onChange, labels }: {
  value: SizePair;
  onChange: (next: SizePair) => void;
  labels: [string, string];
}) {
  const box = (i: 0 | 1) => (
    <input
      value={value[i]}
      onChange={(e) => onChange(i === 0 ? [e.target.value, value[1]] : [value[0], e.target.value])}
      inputMode="decimal"
      autoComplete="off"
      placeholder={labels[i]}
      aria-label={`${labels[i]} (mm)`}
      className={cn(
        'min-w-0 flex-1 sm:flex-none sm:w-24 min-h-11 px-3 rounded-xl text-sm font-mono',
        'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
        'placeholder:font-sans placeholder:text-[var(--glass-muted)] focus:outline-none',
        'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
      )}
    />
  );
  return (
    <div
      role="group"
      aria-label="Search by both sizes"
      title={`${labels[0]} × ${labels[1]} in mm — matches either way round, with the search box`}
      className="flex items-center gap-1.5 shrink-0"
    >
      {box(0)}
      <span aria-hidden="true" className="text-sm text-[var(--glass-muted)]">×</span>
      {box(1)}
    </div>
  );
}
