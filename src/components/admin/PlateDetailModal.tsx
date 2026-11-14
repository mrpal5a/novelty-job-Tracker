'use client';
// src/components/admin/PlateDetailModal.tsx
// One plate, every field. The table shows only a plate's first ID (plus a
// "+N" tag) so long multi-colour sets don't stretch the row; the full list,
// one ID per line, lives here.

import { useId } from 'react';
import { Pencil, X } from 'lucide-react';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import type { Plate } from '@/lib/types';

type Props = {
  plate: Plate;
  plateIds: string[];
  onClose: () => void;
  onEdit?: () => void; // only for departments that can manage plates
};

export default function PlateDetailModal({ plate, plateIds, onClose, onEdit }: Props) {
  const titleId = useId();
  const size = plate.across_size || plate.around_size
    ? `${plate.across_size ?? '—'} × ${plate.around_size ?? '—'} mm`
    : null;

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-black/[0.08] shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)] break-words">
              {plate.item_name || plate.pm_code || 'Plate'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">
              {plate.party || 'No party recorded'}
            </p>
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
            <Detail label="PM code" value={plate.pm_code} mono />
            <Detail label="Location" value={plate.location} />
            <Detail label="Size (across × around)" value={size} mono />
            <Detail label="Cylinder" value={plate.cylinder?.toString()} mono />
            <Detail label="Labels / round" value={plate.label_per_round?.toString()} mono />
            <Detail label="Plate date" value={plate.plate_date ? formatNumericDate(plate.plate_date) : null} mono />
            <Detail label="Added" value={formatAdminDate(plate.created_at)} mono />
            <Detail label="Added by" value={plate.created_by} />
          </dl>

          {/* Last: a set can carry a dozen IDs, and the specs above shouldn't
              be pushed out of view by them. */}
          <section className="pt-4 border-t border-black/[0.08]">
            <h3 className="text-xs font-medium text-[var(--glass-muted)]">
              {plateIds.length === 1 ? 'Plate ID' : `Plate IDs (${plateIds.length})`}
            </h3>
            {plateIds.length > 0 ? (
              <ul className="mt-1.5 rounded-lg border border-black/[0.08] divide-y divide-black/[0.06]">
                {plateIds.map((pid, i) => (
                  <li key={`${i}-${pid}`} className="px-3 py-2 font-mono text-xs font-semibold text-[var(--glass-ink)] break-words">
                    {pid.toUpperCase()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-[var(--glass-muted)]">Not recorded</p>
            )}
          </section>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-black/[0.08] shrink-0">
          <Button intent="ghost" onClick={onClose}>Close</Button>
          {onEdit && <Button intent="primary" icon={Pencil} onClick={onEdit}>Edit plate</Button>}
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
