'use client';
// src/components/admin/ActivityLogView.tsx
// The Activity Log list: newest change first, filtered on the server because
// the log is far too long to bring to the browser. A change shows its old and
// new values; an added or deleted record keeps its fields behind "Show details".

import { useDeferredValue, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { History, Search } from 'lucide-react';
import { cn, formatAdminDateParts } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import {
  ACTIVITY_SECTIONS, changedFields, describeAction,
  type ActivityEntry, type ChangedField,
} from '@/lib/activityLog';

type Page = { entries: ActivityEntry[]; hasMore: boolean };

const fieldCls = cn(
  'min-h-11 px-3 rounded-xl text-sm',
  'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
  'placeholder:text-[var(--glass-muted)] focus:outline-none focus:border-brand-primary focus:shadow-[0_0_0_4px_rgba(16,85,63,0.18)]',
);

const COLUMNS = ['When', 'Who', 'What happened'];

// DESIGN.md §3: Trispace for what you count or copy, DM Sans for words. A value
// here could be either, so go by its shape: starts with a digit, or one
// unbroken code containing one.
const monoIfCode = (text: string) => (/^\d|^\S*\d\S*$/.test(text) ? 'font-mono' : undefined);

function FieldLine({ change, action }: { change: ChangedField; action: ActivityEntry['action'] }) {
  return (
    <li className="break-words">
      <span className="text-[var(--glass-muted)]">{change.field}: </span>
      {action === 'changed' ? (
        <>
          <span className={monoIfCode(change.from)}>{change.from}</span>
          <span aria-hidden="true"> → </span>
          <span className="sr-only"> changed to </span>
          <span className={cn('font-semibold', monoIfCode(change.to))}>{change.to}</span>
        </>
      ) : (
        <span className={monoIfCode(action === 'added' ? change.to : change.from)}>{action === 'added' ? change.to : change.from}</span>
      )}
    </li>
  );
}

function What({ entry }: { entry: ActivityEntry }) {
  const fields = changedFields(entry.changes);
  return (
    <div className="min-w-0">
      <p className="text-[var(--glass-ink)]">
        <span className="font-medium">{describeAction(entry)}</span>
        {entry.label?.split(' · ').map((part, i) => (
          <span key={i}>{i > 0 ? ' · ' : ' '}<span className={monoIfCode(part)}>{part}</span></span>
        ))}
      </p>
      {fields.length > 0 && (entry.action === 'changed' ? (
        <ul className="mt-1 space-y-0.5 text-[13px] leading-[19px]">
          {fields.map((f) => <FieldLine key={f.field} change={f} action={entry.action} />)}
        </ul>
      ) : (
        <details className="mt-1 text-[13px] leading-[19px]">
          <summary className="inline-flex min-h-11 sm:min-h-0 cursor-pointer items-center text-[var(--glass-muted)] hover:text-[var(--glass-ink)]">
            Show details ({fields.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {fields.map((f) => <FieldLine key={f.field} change={f} action={entry.action} />)}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Who({ entry, departments }: { entry: ActivityEntry; departments: Record<string, string> }) {
  if (!entry.actor_id) return <span className="text-[var(--glass-muted)]">System</span>;
  const dept = entry.actor_dept ? departments[entry.actor_dept] ?? entry.actor_dept : null;
  return (
    <>
      <span className="font-medium text-[var(--glass-ink)] break-words">{entry.actor_name ?? 'Removed login'}</span>
      {dept && <span className="block text-[13px] leading-[19px] text-[var(--glass-muted)]">{dept}</span>}
    </>
  );
}

export default function ActivityLogView({ people, departments }: {
  people: { id: string; username: string }[];
  departments: Record<string, string>;
}) {
  const [section, setSection] = useState('');
  const [actor,   setActor]   = useState('');
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [search,  setSearch]  = useState('');
  const q = useDeferredValue(search.trim());

  const query = useInfiniteQuery({
    queryKey: ['activity-log', section, actor, from, to, q],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams(Object.entries({ section, actor, from, to, q }).filter(([, v]) => v));
      if (pageParam) params.set('before', String(pageParam));
      const res  = await fetch(`/api/activity-log?${params}`, { signal });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load the activity log');
      return data as Page;
    },
    getNextPageParam: (last: Page) => (last.hasMore ? last.entries[last.entries.length - 1]?.id : undefined),
  });

  const entries  = query.data?.pages.flatMap((p) => p.entries) ?? [];
  const filtered = !!(section || actor || from || to || q);

  return (
    <div className="space-y-3">
      <div className="flex flex-col flex-wrap gap-2 sm:flex-row sm:items-end">
        <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section" className={fieldCls}>
          <option value="">All sections</option>
          {ACTIVITY_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>

        <select value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Person" className={fieldCls}>
          <option value="">Everyone</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.username}</option>)}
          <option value="system">System</option>
        </select>

        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--glass-muted)]">
          From
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={cn(fieldCls, 'font-mono')} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-[var(--glass-muted)]">
          To
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={cn(fieldCls, 'font-mono')} />
        </label>

        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--glass-muted)]" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job card, PO, PM code or serial no."
            aria-label="Search the activity log"
            title="Search this page (/)"
            data-global-search
            className={cn(fieldCls, 'w-full pl-9 pr-11')}
          />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
        </div>
      </div>

      {query.isLoading ? (
        <div className="glass overflow-hidden rounded-xl">
          <table className="w-full border-collapse text-sm"><tbody><SkeletonRows rows={6} cols={COLUMNS.length} /></tbody></table>
        </div>
      ) : query.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-black/[0.08] bg-[#FEF2F2] px-4 py-4 text-sm text-[#B91C1C] sm:flex-row sm:items-center sm:justify-between">
          <p>{query.error.message}</p>
          <Button onClick={() => query.refetch()}>Try again</Button>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-black/[0.08] bg-white px-4 py-12 text-center">
          <History className="h-6 w-6 text-[var(--glass-muted)]" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-[var(--glass-ink)]">
            {filtered ? 'No changes match these filters.' : 'No changes recorded yet.'}
          </p>
          <p className="mt-1 max-w-[42ch] text-xs text-[var(--glass-muted)]">
            {filtered ? 'Widen the dates, or try all sections and everyone.' : 'The next change anyone saves will appear here.'}
          </p>
        </div>
      ) : (
        <>
          {/* Phone: cards */}
          <ul className="space-y-3 sm:hidden">
            {entries.map((e) => {
              const when = formatAdminDateParts(e.changed_at);
              return (
                <li key={e.id} className="glass rounded-xl p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><Who entry={e} departments={departments} /></div>
                    <p className="shrink-0 text-right font-mono text-[13px] leading-[19px] text-[var(--glass-muted)]">
                      {when?.date}<span className="block">{when?.time}</span>
                    </p>
                  </div>
                  <div className="mt-3 border-t border-black/[0.06] pt-3"><What entry={e} /></div>
                </li>
              );
            })}
          </ul>

          {/* Desk: table */}
          <div className="glass hidden overflow-hidden rounded-xl sm:block">
            <div className="table-scroll-wrapper max-h-[70vh] overflow-y-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {COLUMNS.map((label) => (
                      <th key={label} scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-white/12 bg-[var(--glass-bg-strong)] px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] backdrop-blur-[14px]">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const when = formatAdminDateParts(e.changed_at);
                    return (
                      <tr key={e.id} className={cn('border-b border-white/8 align-top transition-colors hover:bg-black/[0.03]', i % 2 === 1 && 'bg-[var(--glass-bg)]')}>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px] leading-[19px] text-[var(--glass-muted)]">
                          {when?.date}<span className="block">{when?.time}</span>
                        </td>
                        <td className="w-[180px] px-3 py-2"><Who entry={e} departments={departments} /></td>
                        <td className="px-3 py-2"><What entry={e} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button busy={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>Show older changes</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
