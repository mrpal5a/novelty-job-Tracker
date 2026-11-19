'use client';
// src/components/admin/CommandPalette.tsx
// Ctrl K — search everything. One box over jobs, Job Separation lines, shade
// cards, plates, dies (by rack and size too: "437", "210x60"), label stock and parties, plus the sections of the app itself ("slips" → Go to Slips).
//
// Picking a job opens its page. Picking a plate, die or stock entry opens
// that section with its own search already filled (?q=, see useUrlSearch),
// so the full row — and everything you can do with it — is right there.
// A party opens the dashboard searched for that party.
//
// Keyboard: ↑ ↓ move, ↵ opens, Tab / Shift+Tab change the filter, Esc closes.
// Focus stays in the input the whole time (aria-activedescendant points at
// the highlighted row), so typing never stops working.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, FileText, Disc, Scissors, Package, Building2, CornerDownLeft, SplitSquareHorizontal, Palette, type LucideIcon } from 'lucide-react';
import { cn, formatQty, formatNumericDate } from '@/lib/utils';
import { STAGE_DOT } from '@/lib/constants/statusColors';
import { matchRow } from '@/lib/search';
import SearchPreview, { type PreviewTarget } from './SearchPreview';
import { SEARCH_DEBOUNCE_MS } from '@/hooks/useDebouncedSearch';
import type { Stage } from '@/lib/constants/stages';

export type PaletteSection = { href: string; label: string; icon: LucideIcon };

/** Wakes the search route — an empty query is answered right after the
 *  sign-in check — so the first real search doesn't pay the ~1 s cold start
 *  of a server that has been idle. Called on open and when the pointer
 *  reaches the search button; at most once a minute. */
let warmedAt = 0;
export function warmSearch() {
  if (Date.now() - warmedAt < 60_000) return;
  warmedAt = Date.now();
  fetch('/api/search?q=').catch(() => { /* best effort */ });
}

type Filter = 'all' | 'jobs' | 'shade' | 'plates' | 'dies' | 'stock' | 'parties';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',     label: 'All' },
  { id: 'jobs',    label: 'Jobs' },
  { id: 'shade',   label: 'Shade cards' },
  { id: 'plates',  label: 'Plates' },
  { id: 'dies',    label: 'Dies' },
  { id: 'stock',   label: 'Stock' },
  { id: 'parties', label: 'Parties' },
];

type SearchResponse = {
  jobs:    { id: string; job_card_number: string | null; po_number: string; party: string; job_name: string | null; pm_code: string | null; status: Stage; delivery_date: string | null; is_closed: boolean }[];
  separations: { id: string; sr_no: string | null; party: string; po_no: string | null; pm_code: string | null; material_name: string | null; quantity: number | null; cancelled_at: string | null }[];
  shadeCards:  { id: string; shade_card_number: string | null; party: string | null; product_name: string | null; pm_code: string | null; status: string | null }[];
  plates:  { id: string; plate_id: string | null; party: string; pm_code: string | null; item_name: string | null; cylinder: number | null; location: string | null; across_size: string | null; around_size: string | null }[];
  dies:    { id: string; serial_no: string | null; job_name: string; length: string | null; width: string | null; status: string; location: string | null }[];
  flatbed: { id: string; serial_no: number; length: string | null; width: string | null; shape: string | null; location: string | null }[];
  stock:   { id: string; kind: string; party: string; job_name: string | null; pm_code: string | null; job_card_number: string | null; qty: number; location: string | null }[];
  parties: { id: string; name: string }[];
};

type Row = {
  key:    string;
  group:  string;
  filter: Exclude<Filter, 'all'> | 'pages';
  href:   string;
  icon:   LucideIcon;
  title:  React.ReactNode;
  sub?:   React.ReactNode;
  aside?: React.ReactNode;
  /** Shown in full in the preview panel (wide screens). */
  preview?: PreviewTarget;
};

/** Wraps each case-insensitive occurrence of `q` in <mark>. */
function hl(text: string | null | undefined, q: string): React.ReactNode {
  if (!text) return text;
  const needle = q.trim();
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let i = 0;
  for (let at = lower.indexOf(n); at !== -1; at = lower.indexOf(n, i)) {
    if (at > i) parts.push(text.slice(i, at));
    parts.push(<mark key={at} className="rounded-[3px] bg-[#D1FAE5] px-px text-brand-success">{text.slice(at, at + n.length)}</mark>);
    i = at + n.length;
  }
  parts.push(text.slice(i));
  return parts;
}

/** Joins the truthy parts with " · ". */
function sep(...xs: (React.ReactNode | null | undefined | false)[]): React.ReactNode[] {
  return xs.filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]));
}

export default function CommandPalette({
  open, onClose, sections,
}: {
  open:     boolean;
  onClose:  () => void;
  sections: PaletteSection[];
}) {
  const router   = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);
  const [q, setQ]             = useState('');
  const [filter, setFilter]   = useState<Filter>('all');
  const [data, setData]       = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed]   = useState(false);
  const [active, setActive]   = useState(0);

  // Fresh each time it opens; focus goes back where it was on close.
  useEffect(() => {
    if (!open) return;
    warmSearch();
    const prev = document.activeElement as HTMLElement | null;
    setQ(''); setFilter('all'); setData(null); setActive(0); setFailed(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; prev?.focus?.(); };
  }, [open]);

  // Debounced fetch; a newer keystroke cancels the older request.
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setData(null); setLoading(false); setFailed(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
        setFailed(false);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const term = q.trim();
    const enc  = encodeURIComponent(term);
    // Open the plate/die page on the field that matched: the rack, else a
    // size (2–4 digits, as the search route reads it), else All fields.
    const sizeLike = /^\d{2,4}(\.\d+)?$/.test(term);
    const toolQ = (row: { location: string | null }, sizes: readonly string[]) =>
      row.location?.toLowerCase() === term.toLowerCase() ? `q=${enc}&field=location`
      : sizeLike && matchRow([], sizes, term)(row) ? `q=${enc}&field=size`
      : `q=${enc}`;
    const out: Row[] = [];

    if (data) {
      for (const j of data.jobs) out.push({
        key: `job-${j.id}`, preview: { kind: 'job', id: j.id }, group: 'Jobs', filter: 'jobs', href: `/admin/jobs/${j.id}`, icon: FileText,
        title: <>{j.job_card_number && <span className="font-mono">{hl(j.job_card_number.toUpperCase(), term)} · </span>}{hl(j.party, term)}</>,
        sub: sep(hl(j.job_name, term), <>PO <span className="font-mono">{hl(j.po_number, term)}</span></>,
                 j.pm_code && <>PM <span className="font-mono">{hl(j.pm_code, term)}</span></>,
                 j.delivery_date && !j.is_closed && `due ${formatNumericDate(j.delivery_date)}`),
        aside: (
          <span className="inline-flex items-center gap-2 whitespace-nowrap text-[13px] font-semibold text-brand-ink">
            <span aria-hidden="true" className="h-2 w-2 rounded-full shadow-[0_0_0_3px_#EEF2EF]" style={{ background: STAGE_DOT[j.status] ?? '#94A39B' }} />
            {j.status}
          </span>
        ),
      });
      for (const s of data.separations) out.push({
        key: `sep-${s.id}`, preview: { kind: 'separation', id: s.id }, group: 'Job Separation', filter: 'jobs', icon: SplitSquareHorizontal,
        // Its own Sr No, so the page lands on this line (and widens to all dates).
        href: `/admin/job-separation?q=${s.sr_no ? encodeURIComponent(s.sr_no) : enc}`,
        title: <>{s.sr_no && <span className="font-mono">{hl(s.sr_no, term)} · </span>}{hl(s.party, term)}</>,
        sub: sep(hl(s.material_name, term), s.po_no && <>PO <span className="font-mono">{hl(s.po_no, term)}</span></>,
                 s.pm_code && <>PM <span className="font-mono">{hl(s.pm_code, term)}</span></>),
        aside: s.cancelled_at
          ? <span className="text-[13px] text-brand-muted">Cancelled</span>
          : s.quantity != null && <span className="font-mono text-[13px] text-brand-muted">{formatQty(s.quantity)} pcs</span>,
      });
      for (const c of data.shadeCards) out.push({
        key: `shade-${c.id}`, preview: { kind: 'shade', id: c.id }, group: 'Shade cards', filter: 'shade', href: `/admin/shade-cards/${c.id}`, icon: Palette,
        title: <>Shade card {c.shade_card_number && <span className="font-mono">{hl(c.shade_card_number, term)}</span>}{c.party && <> · {hl(c.party, term)}</>}</>,
        sub: sep(hl(c.product_name, term), c.pm_code && <>PM <span className="font-mono">{hl(c.pm_code, term)}</span></>),
        aside: c.status && <span className="text-[13px] text-brand-muted">{c.status}</span>,
      });
      for (const p of data.plates) out.push({
        key: `plate-${p.id}`, preview: { kind: 'plate', id: p.id }, group: 'Plates', filter: 'plates', href: `/admin/plates?${toolQ(p, ['across_size', 'around_size'])}`, icon: Disc,
        title: <>Plate {p.plate_id ? <span className="font-mono">{hl(p.plate_id, term)}</span> : <span className="text-brand-muted">without an ID</span>}</>,
        sub: sep(hl(p.party, term), p.pm_code && <>PM <span className="font-mono">{hl(p.pm_code, term)}</span></>, hl(p.item_name, term),
                 (p.across_size || p.around_size) && <span className="font-mono">{hl([p.across_size, p.around_size].filter(Boolean).join(' × '), term)}</span>,
                 p.cylinder != null && <span className="font-mono">{p.cylinder}T</span>),
        aside: p.location && <span className="font-mono text-[13px] text-brand-muted">Rack {hl(p.location, term)}</span>,
      });
      for (const d of data.dies) out.push({
        key: `die-${d.id}`, preview: { kind: 'die', id: d.id }, group: 'Dies', filter: 'dies', href: `/admin/dies?${toolQ(d, ['length', 'width'])}`, icon: Scissors,
        title: <>Roto die {d.serial_no && <span className="font-mono">{hl(d.serial_no, term)}</span>}</>,
        sub: sep(hl(d.job_name, term), (d.length || d.width) && <span className="font-mono">{hl([d.length, d.width].filter(Boolean).join(' × '), term)}</span>),
        aside: d.location && <span className="font-mono text-[13px] text-brand-muted">Rack {hl(d.location, term)}</span>,
      });
      for (const d of data.flatbed) out.push({
        key: `flat-${d.id}`, preview: { kind: 'flatbed', id: d.id }, group: 'Dies', filter: 'dies', href: `/admin/dies?tab=flatbed&${toolQ(d, ['length', 'width'])}`, icon: Scissors,
        title: <>Flatbed die <span className="font-mono">#{d.serial_no}</span></>,
        sub: sep(hl(d.shape, term), (d.length || d.width) && <span className="font-mono">{hl([d.length, d.width].filter(Boolean).join(' × '), term)}</span>),
        aside: d.location && <span className="font-mono text-[13px] text-brand-muted">Rack {hl(d.location, term)}</span>,
      });
      for (const s of data.stock) out.push({
        key: `stock-${s.id}`, preview: { kind: 'stock', id: s.id }, group: 'Label stock', filter: 'stock', href: `/admin/stock?q=${enc}`, icon: Package,
        title: <><span className="font-mono">{formatQty(s.qty)}</span> labels on the shelf</>,
        sub: sep(s.kind, hl(s.party, term), s.pm_code && <>PM <span className="font-mono">{hl(s.pm_code, term)}</span></>, s.job_card_number && <span className="font-mono">{hl(s.job_card_number.toUpperCase(), term)}</span>),
        aside: s.location && <span className="font-mono text-[13px] text-brand-muted">Rack {hl(s.location, term)}</span>,
      });
      for (const p of data.parties) out.push({
        key: `party-${p.id}`, group: 'Parties', filter: 'parties', href: `/admin?q=${encodeURIComponent(p.name)}`, icon: Building2,
        title: hl(p.name, term),
        sub: 'Show this party’s active jobs',
      });
    }

    // Sections of the app — all of them before typing, matches after.
    const lower = term.toLowerCase();
    for (const s of sections) {
      if (lower && !s.label.toLowerCase().includes(lower)) continue;
      out.push({ key: `go-${s.href}`, group: 'Go to', filter: 'pages', href: s.href, icon: s.icon, title: <>Go to {hl(s.label, term)}</> });
    }

    return out.filter((r) => filter === 'all' || r.filter === filter);
  }, [data, q, filter, sections]);

  // Keep the highlight on a real row as results change.
  useEffect(() => { setActive(0); }, [data, filter, q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  function go(row: Row | undefined) {
    if (!row) return;
    onClose();
    router.push(row.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape')    { e.preventDefault(); onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); return; }
    if (e.key === 'Enter')     { e.preventDefault(); go(rows[active]); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = FILTERS.findIndex((f) => f.id === filter);
      setFilter(FILTERS[(i + (e.shiftKey ? -1 : 1) + FILTERS.length) % FILTERS.length].id);
    }
  }

  const term = q.trim();
  let lastGroup = '';

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- keys bubble from the input; the dialog itself isn't a control
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[10vh]" onKeyDown={onKeyDown}>
      <div aria-hidden="true" className="absolute inset-0 bg-[rgba(12,42,32,0.32)]" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        className="relative flex max-h-[76vh] w-full max-w-[680px] flex-col lg:max-w-[1000px] overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_24px_64px_rgba(12,42,32,0.24)]"
      >
        {/* shrink-0: a long result list scrolls; the box and filters never squeeze. */}
        <label className="flex shrink-0 items-center gap-3 border-b border-brand-border px-5">
          <Search className="h-5 w-5 shrink-0 text-brand-primary" aria-hidden="true" />
          <span className="sr-only">Search jobs, Job Separation, shade cards, plates, dies, stock and parties</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Job card, PO, PM code, party, or a size like 210x60"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={rows[active] ? `palette-row-${active}` : undefined}
            aria-autocomplete="list"
            className="h-16 min-w-0 flex-1 bg-transparent text-[17px] text-brand-ink outline-none placeholder:text-brand-faint"
          />
          <button type="button" onClick={onClose} className="min-h-11 rounded-md px-1 text-brand-muted" aria-label="Close search">
            <Kbd>Esc</Kbd>
          </button>
        </label>

        <div role="group" aria-label="Filter results" className="flex shrink-0 gap-2 overflow-x-auto border-b border-brand-line-soft px-5 py-2.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              tabIndex={-1}
              aria-pressed={filter === f.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setFilter(f.id)}
              className={cn(
                'min-h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
                filter === f.id
                  ? 'border-brand-ink bg-brand-ink text-white'
                  : 'border-brand-border bg-white text-brand-ink hover:bg-brand-surface-alt',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1">
        <div ref={listRef} id="palette-results" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto py-2">
          {rows.map((r, i) => {
            const head = r.group !== lastGroup;
            lastGroup = r.group;
            const Icon = r.icon;
            return (
              <div key={r.key} role="presentation">
                {head && (
                  <div role="presentation" className="px-5 pb-1.5 pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">
                    {r.group}
                  </div>
                )}
                <div
                  id={`palette-row-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(r)}
                  className={cn(
                    'mx-1.5 flex min-h-[52px] cursor-pointer items-center gap-3.5 rounded-xl px-3 py-2',
                    i === active && 'bg-[#EEF6F1] shadow-[inset_0_0_0_1px_#CFE3D7]',
                  )}
                >
                  <span className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]',
                    r.filter === 'pages' ? 'bg-brand-primary text-white' : 'bg-brand-sunken text-brand-primary',
                  )}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-brand-ink">{r.title}</span>
                    {r.sub && <span className="truncate text-xs text-brand-muted">{r.sub}</span>}
                  </span>
                  {r.aside && <span className="hidden shrink-0 sm:inline-flex">{r.aside}</span>}
                  {i === active && <CornerDownLeft className="h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />}
                </div>
              </div>
            );
          })}

          {rows.length === 0 && (
            <p className="px-5 py-10 text-center text-sm text-brand-muted" role="status">
              {failed ? 'Search didn’t go through. Check the connection and try again.'
               : term.length < 2 ? 'Type at least two letters.'
               : loading ? 'Searching…'
               : <>Nothing matches <strong className="text-brand-ink">“{term}”</strong>{filter !== 'all' && ' in this filter'}.</>}
            </p>
          )}
        </div>
        {rows[active] && (
          <SearchPreview target={rows[active].preview} title={rows[active].title} icon={rows[active].icon} onOpen={() => go(rows[active])} />
        )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-brand-line-soft bg-brand-surface-alt px-5 py-2.5 text-xs text-brand-muted">
          <span className="flex gap-4">
            <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span>
            <span><Kbd>↵</Kbd> open</span>
            <span className="hidden sm:inline"><Kbd>Tab</Kbd> filter</span>
          </span>
          <span className="hidden sm:inline">
            {loading && rows.length > 0 ? 'Searching…' : <>Press <Kbd>/</Kbd> to search just this page</>}
          </span>
        </div>
      </section>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-brand-border bg-white px-1.5 py-px font-mono text-[11px] font-medium text-brand-muted">{children}</kbd>;
}
