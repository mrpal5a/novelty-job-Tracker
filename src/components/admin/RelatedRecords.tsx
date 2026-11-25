'use client';
// src/components/admin/RelatedRecords.tsx
// Everything connected to one plate, die or shade card (GET /api/related),
// each a link to its own page. Read-only. Long lists show their newest five.

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { RelatedGroup, RelatedItem } from '@/lib/related';

const SHOWN = 5;
const TAG: Record<string, string> = { Cancelled: 'text-red-700', Damaged: 'text-red-700', Linked: 'text-emerald-700' };

export default function RelatedRecords({ kind, id, onNavigate, wrapDie }: {
  kind: 'plate' | 'die' | 'shade_card'; id: string;
  /** Closes the dialog this sits in: a link to the page underneath changes only its search. */
  onNavigate?: () => void;
  /** Puts a die's row inside its hover card. */
  wrapDie?: (dieId: string, row: ReactNode) => ReactNode;
}) {
  const [open, setOpen] = useState<string[]>([]);
  const { data, isLoading, isError, refetch } = useQuery<{ groups: RelatedGroup[]; limit: number }>({
    queryKey: ['related', kind, id],
    queryFn: async () => {
      const res = await fetch(`/api/related?${kind}=${id}`);
      if (!res.ok) throw new Error('Failed to load related records');
      return res.json();
    },
    staleTime: 60_000,
  });
  const groups = data?.groups ?? [];

  const row = (r: RelatedItem) => (
    <Link href={r.href} onClick={onNavigate} className="block min-h-11 px-3 py-2 hover:bg-black/[0.03] transition-colors">
      <span className="block text-sm font-semibold text-[var(--glass-ink)] break-words">{r.title}</span>
      <span className="block text-xs text-[var(--glass-muted)] break-words">
        {r.detail}
        {r.tag && <span className={cn('ml-1 font-semibold', TAG[r.tag] ?? 'text-amber-700')}>· {r.tag}</span>}
      </span>
    </Link>
  );

  return (
    <section aria-label="Related records">
      <h3 className="text-xs font-medium text-[var(--glass-muted)]">Related records</h3>
      {isLoading ? (
        <p className="mt-1 text-sm text-[var(--glass-muted)]" role="status">Looking for related records…</p>
      ) : isError ? (
        <p className="mt-1 text-sm text-[var(--glass-muted)]" role="alert">
          Couldn’t load them.{' '}
          <button type="button" onClick={() => refetch()} className="min-h-11 font-medium underline underline-offset-2 text-[var(--glass-ink)]">Try again</button>
        </p>
      ) : groups.length === 0 ? (
        <p className="mt-1 text-sm text-[var(--glass-muted)]">Nothing else is connected to this record.</p>
      ) : groups.map((g) => {
        const all = open.includes(g.key);
        const capped = g.items.length >= (data?.limit ?? Infinity);
        return (
          <div key={g.key} className="mt-3 first-of-type:mt-1.5">
            <h4 className="text-sm font-semibold text-[var(--glass-ink)]">
              {g.title} <span className="font-mono font-normal text-[var(--glass-muted)]">{g.items.length}{capped ? '+' : ''}</span>
            </h4>
            {g.note && <p className="text-xs text-[var(--glass-muted)]">{g.note}</p>}
            <ul className="mt-1 rounded-lg border border-black/[0.08] divide-y divide-black/[0.06]">
              {(all ? g.items : g.items.slice(0, SHOWN)).map((r) => (
                <li key={r.id}>{g.key === 'dies' && wrapDie ? wrapDie(r.id, row(r)) : row(r)}</li>
              ))}
            </ul>
            {g.items.length > SHOWN && (
              <button type="button" aria-expanded={all}
                onClick={() => setOpen((o) => (all ? o.filter((k) => k !== g.key) : [...o, g.key]))}
                className="min-h-11 text-sm font-medium text-brand-primary hover:underline underline-offset-2">
                {all ? 'Show fewer' : `Show all ${g.items.length}`}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
