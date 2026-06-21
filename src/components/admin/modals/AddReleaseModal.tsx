'use client';
// src/components/admin/modals/AddReleaseModal.tsx

import { useState } from 'react';
import { cn, formatQty } from '@/lib/utils';

type Props = {
  remaining: number;                 // qty still undelivered for this job
  releaseNumber: number;             // the next release number (display only)
  onCancel: () => void;
  onConfirm: (payload: { qty_this_run: number; planned_date: string; more_runs: boolean }) => void;
};

export default function AddReleaseModal({ remaining, releaseNumber, onCancel, onConfirm }: Props) {
  const [qty,  setQty]  = useState<number | ''>('');
  const [date, setDate] = useState<string>('');

  const qtyNum    = typeof qty === 'number' ? qty : 0;
  const invalid   = qtyNum <= 0 || qtyNum > remaining || !date;
  const moreRuns  = qtyNum < remaining; // false => this release closes out the order

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="glass rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h3 className="text-base font-semibold text-[var(--glass-ink)]">
          Add Release {releaseNumber}
        </h3>
        <p className="text-xs text-[var(--glass-muted)]">
          {formatQty(remaining)} labels remaining to deliver.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--glass-muted)] mb-1 uppercase tracking-wide">
              Release Qty
            </label>
            <input
              type="number"
              min={1}
              max={remaining}
              value={qty}
              onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
              placeholder={`max ${remaining}`}
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)] font-mono"
            />
            {qtyNum > remaining && (
              <p className="text-xs text-[#B23B2E] mt-1">Exceeds remaining quantity.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--glass-muted)] mb-1 uppercase tracking-wide">
              Delivery Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[var(--glass-muted)] hover:text-[var(--glass-ink)]"
          >
            Cancel
          </button>
          <button
            disabled={invalid}
            onClick={() => onConfirm({ qty_this_run: qtyNum, planned_date: date, more_runs: moreRuns })}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white',
              'hover:bg-brand-primary/90 disabled:opacity-40'
            )}
          >
            Add Release
          </button>
        </div>
      </div>
    </div>
  );
}
