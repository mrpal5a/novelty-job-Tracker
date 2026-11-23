'use client';
// src/components/admin/PartySuggestInput.tsx
// A party field that offers names from the party list as you type, so the
// same customer isn't spelt three ways. A name not on the list is still
// saved as typed. Only typing searches — a value filled in by the form
// (e.g. from a PM code) doesn't pop the list open.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Party } from '@/lib/types';
import { useListKeys } from '@/hooks/useListKeys';
import { useParties } from '@/hooks/useReferenceData';
import { findParties } from '@/lib/search';
import { Exiting } from '@/components/ui/Exiting';

const NO_PARTIES: Party[] = [];

export default function PartySuggestInput({
  value, onChange, className, ariaLabel = 'Party', placeholder,
}: { value: string; onChange: (v: string) => void; className?: string; ariaLabel?: string; placeholder?: string }) {
  // The party list is cached in the browser, so suggestions follow each key.
  const { data: parties = NO_PARTIES, isSuccess } = useParties();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => findParties(parties, query), [parties, query]);
  const typed = useRef(value);

  // Filled in by the form, not typed: close the list.
  useEffect(() => {
    if (value === typed.current) return;
    typed.current = value;
    setOpen(false);
  }, [value]);

  function search(q: string) {
    typed.current = q;
    setQuery(q);
    setOpen(Boolean(q.trim()));
  }

  function pick(p: Party) {
    typed.current = p.name;
    onChange(p.name);
    setOpen(false);
  }

  const keys = useListKeys({ items: suggestions, open, onPick: pick, onClose: () => setOpen(false) });

  return (
    <div className="relative">
      <input
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        autoComplete="off"
        {...keys.inputProps}
        onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={className}
      />
      {open && (suggestions.length > 0 || isSuccess) && (
        <Exiting><div {...keys.listProps} className="anim-drop absolute z-20 top-full left-0 right-0 mt-1 glass-strong glass rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {suggestions.length > 0 ? (
            suggestions.map((p, i) => (
              <button
                key={p.id}
                type="button"
                {...keys.optionProps(i)}
                // onMouseDown fires before the input's onBlur closes the list
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                className={cn(
                  'w-full min-h-[44px] text-left px-3 py-2 text-sm text-[var(--glass-ink)] transition-colors border-b border-white/10 last:border-0',
                  i === keys.active && 'bg-brand-surface-hover shadow-[inset_3px_0_0_#10553F]',
                )}
              >
                {p.name}
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-[var(--glass-muted)]">Not on the party list — the name will be saved as typed.</p>
          )}
        </div></Exiting>
      )}
    </div>
  );
}
