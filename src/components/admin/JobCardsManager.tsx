'use client';
// src/components/admin/JobCardsManager.tsx
// The list behind /admin/job-cards. A row opens its card. "New manual card"
// opens the same form, empty, for a job that isn't in Job Separation.
// Production accepts an issued card, or sends it back with a note, from here
// too; a strip on top counts what waits for whom.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardList, MessageSquareWarning, Plus, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { Button, buttonClass } from '@/components/ui/Button';
import { StateChip } from '@/components/ui/StateChip';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import { ConfirmModal, PromptModal } from '@/components/admin/modals';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';
import { useIsDesk } from '@/hooks/useIsDesk';
import { useUrlSearch } from '@/hooks/useUrlSearch';
import { EDIT_NOTE_MAX, JOB_CARD_STATE, cardState, listNumber, type JobCardListRow } from '@/lib/jobCard';

const PAGE = 100;
const NONE: JobCardListRow[] = [];
const fieldCls = cn(
  'w-full min-h-11 px-3 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

const FILTERS = ['manual', 'waiting', 'asked', 'draft'] as const;

export default function JobCardsManager({ canManage, canAccept }: { canManage: boolean; canAccept: boolean }) {
  const [search, setSearch] = useState('');
  // Job Separation links here with ?only=draft.
  const linked = useSearchParams().get('only');
  const [only, setOnly] = useState<string>(FILTERS.find((f) => f === linked && (f !== 'draft' || canManage)) ?? '');
  const [deciding, setDeciding] = useState<{ card: JobCardListRow; kind: 'accept' | 'ask' } | null>(null);
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
          <option value="waiting">Waiting for Production</option>
          <option value="asked">Edit asked by Production</option>
          {canManage && <option value="draft">Open, not issued</option>}
        </select>
        {canManage && (
          <Link href="/admin/job-cards/new" className={cn(buttonClass('primary'), 'max-sm:ml-auto')}><Plus className="w-4 h-4" aria-hidden="true" /> New manual card</Link>
        )}
      </div>

      <div className="flex flex-col gap-2 empty:hidden">
        {canAccept && <Strip only="waiting" current={only} onPick={setOnly} words={(n) => n === 1 ? '1 job card is waiting for you to accept' : `${n} job cards are waiting for you to accept`} />}
        {canManage && <Strip only="asked" current={only} onPick={setOnly} words={(n) => n === 1 ? 'Production asked for an edit on 1 job card' : `Production asked for edits on ${n} job cards`} />}
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
                  {[['Number', 'w-[14%]'], ['Party · job', ''], ['PM code', 'w-[13%]'], ['PO number', 'w-[11%]'], ['Made from', 'w-[12%]'], ['State', 'w-[18%]'],
                    ...(canAccept ? [['Production', 'w-[19%]']] : [])].map(([label, width]) => (
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
                    {canAccept && <td className="px-2.5 py-1.5"><Decide card={c} onPick={(kind) => setDeciding({ card: c, kind })} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {cards.map((c) => (
            <li key={c.id} className="glass rounded-xl">
              <Link href={`/admin/job-cards/${c.id}`} className="block p-4 space-y-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-[var(--glass-ink)]">{listNumber(c) ?? 'No number yet'}</span>
                  <State card={c} />
                </span>
                <span className="block text-sm text-[var(--glass-ink)] break-words">{[c.party, c.job_name, c.part_name].filter(Boolean).join(' · ') || '—'}</span>
                <span className="block text-xs font-mono text-[var(--glass-muted)] break-words">{[c.pm_code, c.po_no && `PO ${c.po_no}`].filter(Boolean).join(' · ')}</span>
                <span className="block text-xs text-[var(--glass-muted)]">{madeFrom(c)}</span>
              </Link>
              {canAccept && canDecide(c) && <div className="px-4 pb-4"><Decide card={c} onPick={(kind) => setDeciding({ card: c, kind })} /></div>}
            </li>
          ))}
        </ul>
      )}

      {cards.length < total && (
        <div className="flex justify-center pt-1"><Button intent="ghost" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, total - cards.length)} more</Button></div>
      )}

      {deciding && <Decision {...deciding} onClose={() => setDeciding(null)} />}
    </div>
  );
}

/** Production's turn: issued, not accepted, its order not cancelled. */
const canDecide = (c: JobCardListRow) => !!c.issued_at && !c.accepted_at && !c.job_separations?.cancelled_at;

function Decide({ card, onPick }: { card: JobCardListRow; onPick: (kind: 'accept' | 'ask') => void }) {
  if (!canDecide(card)) return null;
  const name = listNumber(card) ?? card.job_name ?? 'this card';
  // Above the row's link, which covers the whole row.
  return (
    <span className="relative z-[1] flex flex-wrap gap-1.5">
      <Button icon={Check} onClick={() => onPick('accept')} aria-label={`Accept ${name}`}>Accept</Button>
      <Button icon={MessageSquareWarning} onClick={() => onPick('ask')} aria-label={`Suggest an edit to ${name}`}>{card.edit_request ? 'Change note' : 'Suggest edit'}</Button>
    </span>
  );
}

/** Two steps: the button opens this, and it names the card being accepted or sent back. */
function Decision({ card, kind, onClose }: { card: JobCardListRow; kind: 'accept' | 'ask'; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const number = listNumber(card) ?? 'this job card';
  const what = [card.party, card.job_name, card.part_name, card.pm_code].filter(Boolean).join(' · ');

  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/job-cards/${card.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, issued_at: card.issued_at }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
      toast.success(done);
      queryClient.invalidateQueries({ queryKey: ['job-cards'] });
      queryClient.invalidateQueries({ queryKey: ['job-separations'] });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return kind === 'accept' ? (
    <ConfirmModal title={`Accept job card ${number}?`} confirmLabel="Yes, accept" busy={busy} onCancel={onClose}
      message={<>{what && <span className="block font-medium text-[var(--glass-ink)] mb-2 [overflow-wrap:anywhere]">{what}</span>}
        Open the card and check it first if you haven’t. Once accepted, nobody can change, reopen or delete it. Only Admin can cancel the acceptance.</>}
      onConfirm={() => send({ action: 'accept' }, `${number} accepted`)} />
  ) : (
    <PromptModal title={`Suggest an edit to ${number}`} label="What should Prepress change?" kind="textarea" required
      description={<>{what && <span className="block font-medium text-[var(--glass-ink)] mb-1 [overflow-wrap:anywhere]">{what}</span>}
        The card goes back to Prepress with your note. You accept it once they issue it again.</>}
      initialValue={card.edit_request?.note ?? ''} confirmLabel={busy ? 'Sending…' : 'Send to Prepress'} onCancel={onClose}
      onConfirm={(note) => { if (!busy) send({ action: 'ask', note: note.trim().slice(0, EDIT_NOTE_MAX) }, `Sent back to Prepress`); }} />
  );
}

/** A count of cards waiting for someone, that filters the list to them. Hidden at none. */
function Strip({ only, current, onPick, words }: { only: string; current: string; onPick: (only: string) => void; words: (n: number) => string }) {
  const { data } = useQuery<{ total: number }>({
    queryKey: ['job-cards', 'count', only],
    queryFn: async () => {
      const res = await fetch(`/api/job-cards?only=${only}&limit=1`);
      if (!res.ok) throw new Error('Failed to count job cards');
      return res.json();
    },
  });
  if (!data?.total) return null;
  const on = current === only;
  return (
    <button type="button" onClick={() => onPick(on ? '' : only)} aria-pressed={on}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-11 w-full text-left rounded-xl border border-black/[0.12] bg-white px-4 py-2 hover:bg-black/[0.03] transition-colors">
      <StateChip dot={JOB_CARD_STATE[only === 'asked' ? 'asked' : 'issued'].color} label={words(data.total)} />
      <span className="ml-auto text-[13px] font-semibold text-brand-primary underline underline-offset-2">{on ? 'Show all cards' : 'Show them'}</span>
    </button>
  );
}

const madeFrom = (c: JobCardListRow) => (!c.manual ? 'Job Separation' : c.job_separations ? `By hand, linked to ${c.job_separations.sr_no ?? 'an order'}` : 'By hand');

function State({ card }: { card: JobCardListRow }) {
  const s = JOB_CARD_STATE[cardState(card)];
  return (
    <span className="inline-flex flex-col">
      <StateChip label={s.label} dot={s.color} className="text-xs" />
      <span className="text-xs font-mono text-[var(--glass-muted)]">
        {card.issued_at ? formatNumericDate(card.accepted_at ?? card.issued_at) : <><span className="font-sans">made </span>{formatNumericDate(card.created_at)}</>}
      </span>
      {card.issued_at && !card.accepted_at && !card.edit_request && <span className="text-xs text-[var(--glass-muted)]">Waiting for Production</span>}
      {card.edit_request && (
        <span className="text-xs text-[var(--glass-ink)] line-clamp-3 [overflow-wrap:anywhere]" title={card.edit_request.note}>
          <span className="text-[var(--glass-muted)]">{card.edit_request.by}: </span>{card.edit_request.note}
        </span>
      )}
    </span>
  );
}

