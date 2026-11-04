'use client';
// src/components/admin/LinkLineModal.tsx
// Pick the exact Job Separation line a dispatch entry ships, for one that
// PO + PM code can't place on its own (migration 088): two lines with the same
// codes, a PO typed differently, a PM code left blank. Opens on the likeliest
// lines (lib/dispatchLedger.ts suggestLines); search reaches every live line.
// Going over the order or crossing parties asks once more, like every other
// dispatch check. Nothing is emailed and the entry's date doesn't change.

import { useEffect, useId, useMemo, useState } from 'react';
import { Link2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { nameMatches } from '@/lib/search';
import { suggestLines } from '@/lib/dispatchLedger';
import type { DispatchHistoryRow, DispatchLineOption } from '@/lib/types';
import { StageDialog, Note, dField, dPrimary, dQuiet } from './modals';

const MAX_RESULTS = 30;
const fmt = (n: number) => n.toLocaleString('en-IN');

export default function LinkLineModal({ entry, onClose, onDone }: {
  entry:   DispatchHistoryRow;
  onClose: () => void;
  onDone:  (message: string) => void;
}) {
  const titleId = useId();
  const searchId = useId();
  const [lines, setLines]       = useState<DispatchLineOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ]               = useState('');
  const [picked, setPicked]     = useState<string | null>(entry.line?.id ?? null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [saving, setSaving]     = useState(false);

  // ponytail: every live line per open (~1,300 now); search on the server
  // past ~20k lines.
  async function load() {
    setLoadError(null);
    try {
      const res  = await fetch('/api/dispatch-notifications?view=lines');
      const data = await res.json();
      if (!res.ok) { setLoadError(data.error ?? 'Failed to load the order lines'); return; }
      setLines(data.lines);
    } catch {
      setLoadError('Network error');
    }
  }
  useEffect(() => { load(); }, []);

  const term = q.trim();
  const shown = useMemo(() => {
    if (!lines) return [];
    if (term) {
      return lines.filter((l) => nameMatches([l.sr_no, l.party, l.po_no, l.pm_code, l.material_name].filter(Boolean).join(' '), term)).slice(0, MAX_RESULTS);
    }
    const best = suggestLines(entry, lines);
    const current = lines.find((l) => l.id === entry.line?.id);
    return current ? [current, ...best.filter((l) => l.id !== current.id)] : best;
  }, [lines, term, entry]);

  const pickedLine = lines?.find((l) => l.id === picked) ?? null;
  const pickedName = pickedLine?.sr_no ?? 'this line';
  const unchanged  = !!entry.line_id && picked === entry.line_id;

  async function send(init: RequestInit, done: string) {
    setSaving(true);
    try {
      const res  = await fetch(`/api/dispatch-notifications/${entry.id}/line`, init);
      const data = await res.json();
      if (res.status === 409 && Array.isArray(data.warnings)) { setWarnings(data.warnings); return; }
      if (!res.ok) { toast.error(data.error ?? 'Failed to save the link'); return; }
      onDone(done);
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  const link = () => send(
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line_id: picked, confirm: warnings.length > 0 }) },
    entry.confirmed_at ? `Linked: these labels now count against ${pickedName}` : `Linked to ${pickedName}. Confirm the entry to start counting it`,
  );
  const unlink = () => send({ method: 'DELETE' }, 'Link removed: matching by PO and PM code again');

  return (
    <StageDialog
      titleId={titleId}
      cap="Dispatch entry"
      title="Link to an order line"
      sub={<>
        {entry.party} · PO <span className="font-mono">{entry.po_number}</span>
        {entry.pm_code && <> · PM <span className="font-mono">{entry.pm_code}</span></>}
        {entry.qty != null && <> · <span className="font-mono">{fmt(entry.qty)}</span> labels</>}
        {entry.job_name && <span className="block truncate">{entry.job_name}</span>}
      </>}
      onClose={onClose}
      footer={<>
        {entry.line_id && (
          <button type="button" onClick={unlink} disabled={saving} className={cn(dQuiet, 'mr-auto')}>Remove link</button>
        )}
        <button type="button" onClick={onClose} disabled={saving} className={dQuiet}>Cancel</button>
        <button type="button" onClick={link} disabled={saving || !pickedLine || unchanged} className={dPrimary}>
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {saving ? 'Saving…' : warnings.length ? 'Link anyway' : `Link to ${pickedName}`}
        </button>
      </>}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={searchId} className="text-xs font-medium text-brand-muted">Search all order lines</label>
        <input id={searchId} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sr. No., PO, PM code, item or party" autoComplete="off" className={dField} />
      </div>

      {loadError ? (
        <p role="alert" className="py-4 text-center text-sm text-brand-danger">
          {loadError} <button type="button" onClick={load} className="ml-2 min-h-11 font-medium text-brand-primary underline">Try again</button>
        </p>
      ) : !lines ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 rounded-xl bg-brand-sunken" />)}
        </div>
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-sm text-brand-muted">
          {term ? 'No line matches that search. If the order isn\'t in Job Separation yet, add it first.' : 'No likely line found. Search above to find it.'}
        </p>
      ) : (
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-medium text-brand-muted">{term ? 'Matching lines' : 'Likely lines'}</legend>
          <div className="flex max-h-[38vh] flex-col gap-1.5 overflow-y-auto">
            {shown.map((l) => (
              <label key={l.id} className={cn(
                'flex min-h-11 shrink-0 cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5 transition-colors',
                picked === l.id ? 'border-brand-primary bg-brand-surface-hover' : 'border-brand-border bg-white hover:bg-brand-surface-hover',
              )}>
                <input type="radio" name="order-line" checked={picked === l.id} onChange={() => { setPicked(l.id); setWarnings([]); }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#10553F]" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-mono text-[13px] font-medium text-brand-ink">{l.sr_no ?? 'No Sr. No.'}</span>
                    {l.quantity != null && <span className="font-mono text-xs text-brand-muted">{fmt(l.entered)} of {fmt(l.quantity)} entered</span>}
                  </span>
                  {l.material_name && <span className="block truncate text-[13px] text-brand-ink">{l.material_name}</span>}
                  <span className="block truncate text-xs text-brand-muted">
                    {l.party} · PO <span className="font-mono">{l.po_no ?? '—'}</span>{l.pm_code && <> · PM <span className="font-mono">{l.pm_code}</span></>}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {warnings.length > 0 && <Note tone="warn">{warnings.join(' ')}</Note>}
      <p className="text-xs text-brand-muted">Nothing is emailed, and the entry keeps its date.</p>
    </StageDialog>
  );
}
