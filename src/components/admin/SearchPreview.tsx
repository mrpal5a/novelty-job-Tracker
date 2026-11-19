'use client';
// src/components/admin/SearchPreview.tsx
// The Ctrl K palette's preview panel: everything about the highlighted
// result, so a rack, size or due date can be read without opening the page.
// It follows the highlighted row — the arrow keys and the mouse both move
// it — so it works the same for keyboard and mouse, and doesn't flicker the
// way a hover card does. Wide screens only; on a phone a tap opens the page.
//
// Loads one row at a time (GET /api/search/preview), a moment after the
// highlight settles, and remembers it while the palette is open.

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, type LucideIcon } from 'lucide-react';
import { formatQty, formatNumericDate } from '@/lib/utils';
import { STAGE_DOT } from '@/lib/constants/statusColors';

export type PreviewTarget = { kind: 'job' | 'plate' | 'die' | 'flatbed' | 'separation' | 'shade' | 'stock'; id: string };

type Data = Record<string, unknown>;
type Field = [label: string, value: React.ReactNode, mono?: boolean];

const SETTLE_MS = 150;

export default function SearchPreview({
  target, title, icon: Icon, onOpen,
}: {
  target: PreviewTarget | undefined;
  title:  React.ReactNode;
  icon:   LucideIcon;
  onOpen: () => void;
}) {
  const cache = useRef(new Map<string, Data>());
  const key = target && `${target.kind}:${target.id}`;
  const [row, setRow] = useState<{ key: string; data: Data } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!target || !key) return;
    const hit = cache.current.get(key);
    if (hit) { setRow({ key, data: hit }); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/preview?kind=${target.kind}&id=${target.id}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { row: data } = await res.json() as { row: Data };
        cache.current.set(key, data);
        setRow({ key, data });
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setFailed(true);
      }
    }, SETTLE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers target
  }, [key]);

  const data = row && row.key === key ? row.data : null;
  const fields = target && data ? fieldsFor(target.kind, data).filter(([, v]) => v != null && v !== '' && v !== false) : [];

  return (
    <aside aria-label="Preview" aria-live="polite" className="hidden w-[320px] shrink-0 flex-col border-l border-brand-line-soft lg:flex">
      <div className="flex items-start gap-3 border-b border-brand-line-soft px-5 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-brand-sunken text-brand-primary">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="min-w-0 break-words text-sm font-semibold text-brand-ink">{title}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
        {!target ? (
          <p className="py-6 text-sm text-brand-muted">Press <span className="font-semibold">↵</span> to open.</p>
        ) : failed ? (
          <p className="py-6 text-sm text-brand-muted" role="status">Details didn’t load. Press ↵ to open the page.</p>
        ) : !data ? (
          <div className="space-y-3 py-1" aria-hidden="true">
            {[70, 50, 85, 60, 40].map((w) => <div key={w} className="h-4 rounded bg-brand-sunken" style={{ width: `${w}%` }} />)}
          </div>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px]">
            {fields.map(([label, value, mono]) => (
              <div key={label} className="contents">
                <dt className="text-brand-muted">{label}</dt>
                <dd className={`min-w-0 whitespace-pre-line break-words text-brand-ink ${mono ? 'font-mono' : ''}`}>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
        className="m-3 mt-0 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-ink text-sm font-semibold text-white hover:bg-brand-primary"
      >
        Open <CornerDownLeft className="h-4 w-4" aria-hidden="true" />
      </button>
    </aside>
  );
}

const str  = (v: unknown) => (v == null || v === '' ? null : String(v));
const date = (v: unknown) => (typeof v === 'string' && v ? formatNumericDate(v) : null);
const qty  = (v: unknown) => (typeof v === 'number' ? formatQty(v) : null);
const notYet = <span className="font-sans text-brand-muted">Not yet</span>;
const size = (a: unknown, b: unknown) => [str(a), str(b)].filter(Boolean).join(' × ') || null;

function fieldsFor(kind: PreviewTarget['kind'], d: Data): Field[] {
  switch (kind) {
    case 'job': {
      const status = String(d.status ?? '');
      const unit = (d.printing_units as { name?: string } | null)?.name;
      return [
        ['Stage', status && (
          <span className="inline-flex items-center gap-2 font-semibold">
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: STAGE_DOT[status as keyof typeof STAGE_DOT] ?? '#94A39B' }} />
            {d.is_closed ? `${status} · closed` : status}
          </span>
        )],
        ['Urgent', d.urgent ? 'Yes' : null],
        ['Party', str(d.party)],
        ['Job', str(d.job_name)],
        ['PO', str(d.po_number), true],
        ['PO date', date(d.po_date), true],
        ['PM code', str(d.pm_code), true],
        ['Quantity', qty(d.label_qty), true],
        ['Dispatched', d.dispatched_qty ? qty(d.dispatched_qty) : null, true],
        ['Remaining', qty(d.remaining_qty), true],
        ['Due', d.is_closed ? null : date(d.delivery_date), true],
        ['Printing', [str(d.printing_method), unit].filter(Boolean).join(' · ') || null],
        ['Type', str(d.job_type)],
        ['On hold', str(d.halt_remark)],
        ['Notes', str(d.notes)],
      ];
    }
    case 'plate':
      return [
        ['Rack', str(d.location), true],
        ['Party', str(d.party)],
        ['Item', str(d.item_name)],
        ['PM code', str(d.pm_code), true],
        ['Size', size(d.across_size, d.around_size), true],
        ['Cylinder', d.cylinder != null ? `${d.cylinder}T` : null, true],
        ['Labels / round', str(d.label_per_round), true],
        ['Plate ID', str(d.plate_id), true],
        ['Plate date', date(d.plate_date), true],
      ];
    case 'die':
      return [
        ['Rack', str(d.location), true],
        ['Serial no', str(d.serial_no), true],
        ['Job', str(d.job_name)],
        ['Size', size(d.length, d.width), true],
        ['Cylinder', d.cylinder != null ? `${d.cylinder}T` : null, true],
        ['Ups', str(d.ups), true],
        ['Gap', str(d.gap), true],
        ['Corner', str(d.corner)],
        ['Material', str(d.material)],
        ['Status', str(d.status)],
        ['Damage', str(d.damage_reason)],
        ['Received', date(d.die_received_on), true],
      ];
    case 'flatbed':
      return [
        ['Rack', str(d.location), true],
        ['Serial no', d.serial_no != null ? `#${d.serial_no}` : null, true],
        ['Shape', str(d.shape)],
        ['Size', size(d.length, d.width), true],
        ['Repeat', str(d.repeat_length), true],
        ['Ups', str(d.ups), true],
        ['Gap', str(d.gap), true],
        ['Corner', str(d.corner)],
        ['Received', date(d.die_received_on), true],
      ];
    case 'separation':
      return [
        ['Cancelled', d.cancelled_at ? [date(d.cancelled_at), str(d.cancel_reason)].filter(Boolean).join(' · ') : null],
        ['Party', str(d.party)],
        ['Material', str(d.material_name)],
        ['PO', str(d.po_no), true],
        ['PO date', date(d.po_date), true],
        ['PM code', str(d.pm_code), true],
        ['Quantity', qty(d.quantity), true],
        // The factory unit (1, 2 or "1&2"), not a unit of measure.
        ['Unit', str(d.unit)],
        ['Job status', str(d.job_status)],
        ['Job card', str(d.linked_job_card_number)?.toUpperCase() ?? str(d.jc_status), true],
        ['Artwork to', str(d.aw_send_to)],
      ];
    case 'shade':
      return [
        ['Status', [str(d.status), str(d.making_status)].filter(Boolean).join(' · ') || null],
        ['Version', typeof d.version === 'number' && d.version > 1 ? `v${d.version}` : null, true],
        ['Party', str(d.party)],
        ['Product', str(d.product_name)],
        ['PM code', str(d.pm_code), true],
        ['Docket', str(d.docket_number), true],
        // Where the card is in its round trip: these always show, so a blank
        // reads as "not yet", not as missing.
        ['Prepared', date(d.prepared_date) ?? notYet, true],
        ['Sent', date(d.sent_to_party_date) ?? notYet, true],
        ['Received back', date(d.received_back_date) ?? notYet, true],
        ['Approved', date(d.approval_date) ?? notYet, true],
        ['Notes', str(d.notes)],
      ];
    case 'stock':
      return [
        ['Rack', str(d.location), true],
        ['Kind', str(d.kind)],
        ['Quantity', qty(d.qty), true],
        ['Party', str(d.party)],
        ['Job', str(d.job_name)],
        ['Job card', str(d.job_card_number)?.toUpperCase() ?? null, true],
        ['PO', str(d.po_number), true],
        ['PM code', str(d.pm_code), true],
        ['Remark', str(d.remark)],
        ['Added', date(d.created_at), true],
      ];
  }
}
