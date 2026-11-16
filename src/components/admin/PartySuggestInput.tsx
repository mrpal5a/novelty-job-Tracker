'use client';
// src/components/admin/PartySuggestInput.tsx
// A party field that offers names from the party list as you type, so the
// same customer isn't spelt three ways. A name not on the list is still
// saved as typed. Only typing searches — a value filled in by the form
// (e.g. from a PM code) doesn't pop the list open.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Party } from '@/lib/types';
import { useListKeys } from '@/hooks/useListKeys';

export default function PartySuggestInput({
  value, onChange, className, ariaLabel = 'Party',
}: { value: string; onChange: (v: string) => void; className?: string; ariaLabel?: string }) {
  const [suggestions, setSuggestions] = useState<Party[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // Bumped on every keystroke or outside change: a slow answer to an older
  // search must not open the list over what is in the field now.
  const latest = useRef(0);
  const typed = useRef(value);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Filled in by the form, not typed: drop any pending search and close.
  useEffect(() => {
    if (value === typed.current) return;
    typed.current = value;
    latest.current++;
    clearTimeout(timer.current);
    setOpen(false);
  }, [value]);

  function search(q: string) {
    typed.current = q;
    const id = ++latest.current;
    clearTimeout(timer.current);
    if (!q.trim()) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/parties?search=${encodeURIComponent(q.trim())}`);
        if (!res.ok) return;
        const parties = (await res.json()).parties ?? [];
        if (id !== latest.current) return;
        setSuggestions(parties);
        setOpen(true);
      } catch {
        // Best-effort — the field still takes a typed name.
      }
    }, 250);
  }

  function pick(p: Party) {
    clearTimeout(timer.current);
    latest.current++;
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
        autoComplete="off"
        {...keys.inputProps}
        onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={className}
      />
      {open && (
        <div {...keys.listProps} className="absolute z-20 top-full left-0 right-0 mt-1 glass-strong glass rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
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
        </div>
      )}
    </div>
  );
}
