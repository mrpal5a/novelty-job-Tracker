'use client';
// src/components/admin/PlateFinder.tsx
// Picking a job card's plate by hand, when its PM code finds none or another:
// searches every plate, as the Plates page does.

import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import type { Plate } from '@/lib/types';

const SHOWN = 8;

export default function PlateFinder({ label, busy, onPick }: { label: string; busy: boolean; onPick: (plate: Plate) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const q = useDebouncedSearch(text).trim();
  const { data, isFetching, isError } = useQuery<{ plates: Plate[]; total: number }>({
    queryKey: ['plates', 'finder', q],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/plates?${new URLSearchParams({ search: q, limit: String(SHOWN) })}`, { signal });
      if (!res.ok) throw new Error('Failed to search plates');
      return res.json();
    },
    enabled: open && q.length >= 2,
    placeholderData: keepPreviousData,
  });
  const plates = q.length >= 2 ? data?.plates ?? [] : [];

  if (!open) return <div className="sm:col-span-2 lg:col-span-4"><Button size="sm" icon={Search} disabled={busy} onClick={() => setOpen(true)}>{label}</Button></div>;
  return (
    <div className="sm:col-span-2 lg:col-span-4 rounded-lg border border-black/[0.12] p-3">
      <div className="flex items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className="block mb-1 text-xs font-medium text-brand-muted">Find a plate by PM code, item, party or plate ID</span>
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            className="w-full min-h-11 rounded-lg border border-black/[0.14] bg-white px-3 text-sm text-brand-ink outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20" />
        </label>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close plate search"
          className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-brand-muted hover:bg-black/[0.04]"><X className="w-4 h-4" aria-hidden="true" /></button>
      </div>
      <p className="mt-1.5 text-xs text-brand-muted" aria-live="polite">
        {q.length < 2 ? 'Type at least two letters or digits.' : isError ? 'Couldn’t search the plates. Try again.'
          : isFetching && !data ? 'Searching…' : !data?.total ? 'No plate matches.'
          : data.total > SHOWN ? `${data.total} plates match; the newest ${SHOWN} are shown. Type more to narrow it.` : `${data.total} ${data.total === 1 ? 'plate matches' : 'plates match'}.`}
      </p>
      {plates.length > 0 && (
        <ul className="mt-2 rounded-lg border border-black/[0.08] divide-y divide-black/[0.06]">
          {plates.map((p) => (
            <li key={p.id}>
              <button type="button" disabled={busy} onClick={() => onPick(p)} className="block w-full min-h-11 px-3 py-2 text-left hover:bg-brand-surface-hover disabled:opacity-60 transition-colors">
                <span className="block text-sm font-semibold text-brand-ink break-words">{p.item_name || p.pm_code || p.party}</span>
                <span className="block text-xs text-brand-muted break-words">
                  {[p.party, p.pm_code && `PM ${p.pm_code}`, `${p.across_size ?? '—'} × ${p.around_size ?? '—'}`, p.cylinder && `${p.cylinder}T`, `at ${p.location || '—'}`,
                    p.plate_id?.split('\n')[0].trim()].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
