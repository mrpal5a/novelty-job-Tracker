'use client';
// src/components/admin/DieDetailModal.tsx
// One roto die, every field — opened by clicking its row. The table keeps
// to what's read at the rack; damage (date + reason) lives here instead of
// taking a column that's blank for almost every die.

import { useId } from 'react';
import { Pencil, X } from 'lucide-react';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { StateChip } from '@/components/ui/StateChip';
import { ModalShell } from './modals';
import type { Die, DieStatus } from '@/lib/types';
import { layoutPair } from '@/lib/plateDie';

// A die's state as a dot + its name (StateChip). The stored values are
// upper case; the screen says them in sentence case.
export const STATUS_DOT: Record<DieStatus, string> = {
  'IN USE': '#059669',
  'EXTRA':  '#D97706',
  'DAMAGE': '#B91C1C',
};
export const STATUS_LABEL: Record<DieStatus, string> = {
  'IN USE': 'In use',
  'EXTRA':  'Extra',
  'DAMAGE': 'Damaged',
};

type Props = {
  die: Die;
  srNo?: number;
  onClose: () => void;
  onEdit?: () => void; // only for departments that can manage dies
};

export default function DieDetailModal({ die, srNo, onClose, onEdit }: Props) {
  const titleId = useId();
  const size = [die.length, die.width].filter(Boolean).join(' × ');
  const isDamaged = die.status === 'DAMAGE';

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-black/[0.08] shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)] break-words">
              {die.job_name || 'Die'}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <StateChip label={STATUS_LABEL[die.status] ?? die.status} dot={STATUS_DOT[die.status]} className="text-xs" />
              {die.serial_no && (
                <span className="font-mono text-xs font-semibold text-[var(--glass-ink)]">{die.serial_no.toUpperCase()}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex items-center justify-center min-h-11 min-w-11 -m-2 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04] transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            <Detail label="Sr No" value={srNo?.toString()} mono />
            <Detail label="Location" value={die.location} />
            <Detail label="Size" value={size} mono />
            <Detail label="Cylinder" value={die.cylinder?.toString()} mono />
            <Detail label="Corner" value={die.corner} />
            <Detail label="Material" value={die.material} />
            <Detail label="Shape" value={die.shape} />
            <Detail label="Labels / round" value={die.ups?.toString()} mono />
            <Detail label="Width" value={layoutPair(die.around_ups, die.around_gap)} mono />
            <Detail label="Height" value={layoutPair(die.across_ups, die.across_gap)} mono />
            <Detail label="First used" value={formatNumericDate(die.die_received_on)} mono />
            <Detail label="Added" value={formatAdminDate(die.created_at)} mono />
          </dl>

          <section className="pt-4 border-t border-black/[0.08]">
            <h3 className="text-xs font-medium text-[var(--glass-muted)]">Damage</h3>
            {isDamaged ? (
              <div className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                <p className="font-semibold font-mono">{die.damage_date ? formatNumericDate(die.damage_date) : 'Date not recorded'}</p>
                <p className="mt-0.5 break-words">{die.damage_reason || 'No reason recorded'}</p>
              </div>
            ) : (
              <p className="mt-1 text-sm text-[var(--glass-muted)]">Not damaged</p>
            )}
          </section>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-black/[0.08] shrink-0">
          <Button intent="ghost" onClick={onClose}>Close</Button>
          {onEdit && <Button intent="primary" icon={Pencil} onClick={onEdit}>Edit die</Button>}
        </div>
      </div>
    </ModalShell>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--glass-muted)]">{label}</dt>
      <dd className={cn('text-sm font-semibold text-[var(--glass-ink)] mt-0.5 break-words', mono && 'font-mono')}>
        {value || '—'}
      </dd>
    </div>
  );
}
