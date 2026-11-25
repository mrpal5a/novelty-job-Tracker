'use client';
// src/components/admin/JobCardsManager.tsx
// The list behind /admin/job-cards. A row opens its card. "New manual card"
// opens the same form, empty, for a job that isn't in Job Separation.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, Search } from 'lucide-react';
import { cn, formatNumericDate } from '@/lib/utils';
import { Button, buttonClass } from '@/components/ui/Button';
import { StateChip } from '@/components/ui/StateChip';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { useIsDesk } from '@/hooks/useIsDesk';
import { useUrlSearch } from '@/hooks/useUrlSearch';
import { JOB_CARD_STATE, cardState, listNumber, type JobCardListRow } from '@/lib/jobCard';

const PAGE = 100;
const NONE: JobCardListRow[] = [];
const fieldCls = cn(
  'w-full min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

export default function JobCardsManager({ canManage }: { canManage: boolean }) {
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useUrlSearch(setSearch);
  const debounced = useDebouncedSearch(search);
  useEffect(() => setLimit(PAGE), [debounced, only]);
  const isWide = useIsDesk(1024);

  const { data, isLoading, error, refetch } = useQuery<{ cards: JobCardListRow[]; total: number }>({
    queryKey: ['job-cards', debounced, only, limit],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (debounced) params.set('search', debounced);
      if (only) params.set('only', only);
      const res = await fetch(`/api/job-cards?${params}`, { signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Failed to load job cards');
      return body;
    },
    placeholderData: keepPreviousData,
  });
  const cards = data?.cards ?? NONE;
  const total = data?.total ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <div className="relative order-first basis-full sm:order-none sm:basis-auto sm:flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PM code, job name, party, PO or number"
            aria-label="Search job cards" data-global-search className={cn(fieldCls, 'pl-9 pr-11 rounded-xl')} />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
        </div>
        <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Which cards" className={cn(fieldCls, 'w-auto rounded-xl')}>
          <option value="">All cards</option>
          <option value="manual">Made by hand</option>
          {canManage && <option value="draft">Not issued</option>}
        </select>
        {canManage && (
          <Link href="/admin/job-cards/new" className={cn(buttonClass('primary'), 'max-sm:ml-auto')}><Plus className="w-4 h-4" aria-hidden="true" /> New manual card</Link>
        )}
      </div>

      {!isLoading && total > 0 && (
        <p className="text-sm text-[var(--glass-muted)]"><strong className="text-[var(--glass-ink)]">{total}</strong> {total === 1 ? 'job card' : 'job cards'}{debounced && ' matching your search'}</p>
      )}

      {error ? (
        <div className="glass rounded-2xl p-8 text-center space-y-3" role="alert">
          <p className="text-sm text-[var(--glass-ink)]">{(error as Error).message}</p>
          <Button onClick={() => refetch()}>Try again</Button>
        </div>
      ) : isLoading ? (
        <div className="glass rounded-2xl h-64 animate-pulse motion-reduce:animate-none" role="status" aria-label="Loading job cards" />
      ) : cards.length === 0 ? (
        <div className="flex flex-col items-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
          <ClipboardList className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">{debounced || only ? 'No job cards match.' : 'No job cards yet.'}</p>
          <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[46ch]">
            {debounced || only ? 'Try the PM code, the job name, the party or the card number.' : 'Prepress makes them from Job Separation, or here by hand.'}
          </p>
        </div>
      ) : isWide ? (
        <div className="rounded-xl glass overflow-hidden">
          <div className="relative max-h-[70vh] overflow-y-auto">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr>
                  {[['Number', 'w-[15%]'], ['Party · job', ''], ['PM code', 'w-[15%]'], ['PO number', 'w-[13%]'], ['Made from', 'w-[13%]'], ['State', 'w-[17%]']].map(([label, width]) => (
                    <th key={label} scope="col" className={cn('sticky top-0 z-10 px-2.5 py-2 text-left bg-[var(--glass-bg-strong)] border-b border-white/12', width)}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cards.map((c, i) => (
                  <tr key={c.id} className={cn('relative border-b border-white/8 hover:bg-black/[0.03]', i % 2 === 1 && 'bg-[var(--glass-bg)]')}>
                    <td className="px-2.5 py-1">
                      <Link href={`/admin/job-cards/${c.id}`} className="flex min-h-11 items-center font-mono font-semibold text-[var(--glass-ink)] after:absolute after:inset-0 [overflow-wrap:anywhere]">
                        {listNumber(c) ?? 'No number yet'}
                      </Link>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <p className="font-semibold text-[var(--glass-ink)] [overflow-wrap:anywhere]">{c.party || '—'}</p>
                      <p className="text-xs text-[var(--glass-muted)] [overflow-wrap:anywhere]">{[c.job_name, c.part_name].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-2.5 py-1.5 font-mono [overflow-wrap:anywhere]">{c.pm_code ?? '—'}</td>
                    <td className="px-2.5 py-1.5 font-mono [overflow-wrap:anywhere]">{c.po_no ?? '—'}</td>
                    <td className="px-2.5 py-1.5 text-[var(--glass-muted)]">{madeFrom(c)}</td>
                    <td className="px-2.5 py-1.5"><State card={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/job-cards/${c.id}`} className="block glass rounded-xl p-4 space-y-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-[var(--glass-ink)]">{listNumber(c) ?? 'No number yet'}</span>
                  <State card={c} />
                </span>
                <span className="block text-sm text-[var(--glass-ink)] break-words">{[c.party, c.job_name, c.part_name].filter(Boolean).join(' · ') || '—'}</span>
                <span className="block text-xs font-mono text-[var(--glass-muted)] break-words">{[c.pm_code, c.po_no && `PO ${c.po_no}`].filter(Boolean).join(' · ')}</span>
                <span className="block text-xs text-[var(--glass-muted)]">{madeFrom(c)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {cards.length < total && (
        <div className="flex justify-center pt-1"><Button intent="ghost" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, total - cards.length)} more</Button></div>
      )}
    </div>
  );
}

const madeFrom = (c: JobCardListRow) => (!c.manual ? 'Job Separation' : c.job_separations ? `By hand, linked to ${c.job_separations.sr_no ?? 'an order'}` : 'By hand');

function State({ card }: { card: JobCardListRow }) {
  const s = JOB_CARD_STATE[cardState(card)];
  return (
    <span className="inline-flex flex-col">
      <StateChip label={s.label} dot={s.color} className="text-xs" />
      {card.issued_at && <span className="text-xs font-mono text-[var(--glass-muted)]">{formatNumericDate(card.issued_at)}</span>}
    </span>
  );
}

