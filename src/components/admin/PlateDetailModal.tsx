'use client';
// src/components/admin/PlateDetailModal.tsx
// One plate, every field. The table shows only a plate's first ID (plus a
// "+N" tag) so long multi-colour sets don't stretch the row; the full list,
// one ID per line, lives here.

import { useId } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Copy, Pencil, X } from 'lucide-react';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import RelatedRecords from './RelatedRecords';
import { DieHover } from './DiePicker';
import type { Die, Plate } from '@/lib/types';
import { dieListQuery, flatbedDieListQuery } from '@/lib/listQueries';
import { dieItem } from '@/lib/related';
import { FORMS, dieUpsFor, flatbedDiesFor, layoutPair, sameMaterial } from '@/lib/plateDie';

type MatchedDie = {
  id: string;
  kind: 'Roto' | 'Flatbed';
  die?: Die;          // roto: its record, shown on hover
  location: string | null;
  detail: (string | number | false | null)[];
  status: 'Damaged' | 'Extra' | null;
  linked?: boolean;   // the die this plate is linked to
  href: string;
};

type Props = {
  plate: Plate;
  plateIds: string[];
  onClose: () => void;
  onEdit?: () => void; // only for departments that can manage plates
  onDuplicate?: () => void; // the same departments
};

export default function PlateDetailModal({ plate, plateIds, onClose, onEdit, onDuplicate }: Props) {
  const titleId = useId();
  const size = plate.across_size || plate.around_size
    ? `${plate.across_size ?? '—'} × ${plate.around_size ?? '—'} mm`
    : null;

  // The dies this plate can run with: roto dies of the same cylinder and
  // whole-mm size (either way round), its linked die first and then those cut
  // for its material, and flatbed dies of the same size (they have no cylinder).
  const across = plate.across_size ?? '', around = plate.around_size ?? '';
  const rotoQuery    = useQuery(dieListQuery());
  const flatbedQuery = useQuery(flatbedDieListQuery());
  const loading = rotoQuery.isLoading || flatbedQuery.isLoading;
  const failed  = rotoQuery.isError || flatbedQuery.isError;
  const roto = dieUpsFor(rotoQuery.data ?? [], across, around, plate.cylinder?.toString() ?? '', plate.material);
  const linkedDie = rotoQuery.data?.find((d) => d.id === plate.die_id);
  const dies: MatchedDie[] = [
    ...(linkedDie ? [linkedDie, ...roto.dies.filter((d) => d.id !== linkedDie.id)] : roto.dies).map((d) => ({
      id: d.id,
      kind: 'Roto' as const,
      die: d,
      location: d.location,
      detail: [d.serial_no, d.job_name, d.material, sameMaterial(d.material, plate.material) && 'Same material', d.ups != null && `${d.ups} ups`],
      status: d.status === 'DAMAGE' ? 'Damaged' as const : d.status === 'EXTRA' ? 'Extra' as const : null,
      linked: d.id === plate.die_id,
      href: dieHref(d),
    })),
    ...flatbedDiesFor(flatbedQuery.data ?? [], across, around).map((d) => ({
      id: d.id,
      kind: 'Flatbed' as const,
      location: d.location,
      detail: [`${d.length} × ${d.width} mm`, d.ups != null && `${d.ups} ups`, d.shape],
      status: null,
      href: `/admin/dies?tab=flatbed&field=size&q=${encodeURIComponent(d.length ?? '')}`,
    })),
  ];

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
            <Detail label="Size (height × width)" value={size} mono />
            <Detail label="Cylinder" value={plate.cylinder?.toString()} mono />
            <Detail label="Material" value={plate.material} />
            <Detail label="Roll / sheet" value={FORMS.find((f) => f.value === plate.roll_sheet)?.label} />
            <Detail label="Unwind" value={plate.direction} mono />
            <Detail label="Labels / round" value={plate.label_per_round?.toString()} mono />
            <Detail label="Total colours" value={plate.total_colors?.toString()} mono />
            {plate.colors && (
              <Detail
                wide
                label="Colours"
                value={plate.colors.map((c, i) => `${i + 1} ${c ?? '—'}`).join(' · ')}
              />
            )}
            {linkedDie ? (
              <div className="min-w-0">
                <dt className="text-xs font-medium text-[var(--glass-muted)]">Roto die (linked)</dt>
                <dd>
                  <DieHover die={linkedDie}>
                    <Link href={dieHref(linkedDie)} className="flex flex-wrap items-center gap-x-2 min-h-11 -my-2.5 text-sm font-semibold text-[var(--glass-ink)] underline decoration-dotted underline-offset-4">
                      Location {linkedDie.location || 'not recorded'}
                      {linkedDie.serial_no && <span className="font-mono text-xs">{linkedDie.serial_no.toUpperCase()}</span>}
                    </Link>
                  </DieHover>
                </dd>
              </div>
            ) : <Detail label="Roto die" value={plate.die_id ? 'Linked' : 'Not linked'} />}
            <Detail label="Width" value={layoutPair(plate.around_ups, plate.around_gap)} mono />
            <Detail label="Height" value={layoutPair(plate.across_ups, plate.across_gap)} mono />
            <Detail label="Plate date" value={plate.plate_date ? formatNumericDate(plate.plate_date) : null} mono />
            <Detail label="Added" value={formatAdminDate(plate.created_at)} mono />
            <Detail label="Added by" value={plate.created_by} />
          </dl>

          <section className="pt-4 border-t border-black/[0.08]">
            <h3 className="text-xs font-medium text-[var(--glass-muted)]">
              {dies.length > 1 ? `Matching dies (${dies.length})` : 'Matching die'}
            </h3>
            {loading ? (
              <p className="mt-1 text-sm text-[var(--glass-muted)]">Looking for the die…</p>
            ) : dies.length === 0 ? (
              <p className="mt-1 text-sm text-[var(--glass-muted)]">
                {failed ? 'Couldn’t load dies' : 'No roto or flatbed die of this size on record'}
              </p>
            ) : (
              <ul className="mt-1.5 rounded-lg border border-black/[0.08] divide-y divide-black/[0.06]">
                {dies.map((d) => (
                  <li key={`${d.kind}-${d.id}`}>
                    {d.die ? <DieHover die={d.die}><DieRow d={d} /></DieHover> : <DieRow d={d} />}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="pt-4 border-t border-black/[0.08]">
            <RelatedRecords
              kind="plate" id={plate.id} onNavigate={onClose}
              wrapDie={(dieId, row) => {
                const die = rotoQuery.data?.find((d) => d.id === dieId);
                return die ? <DieHover die={die}>{row}</DieHover> : row;
              }}
            />
          </div>

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
          {onDuplicate && <Button icon={Copy} onClick={onDuplicate}>Duplicate</Button>}
          {onEdit && <Button intent="primary" icon={Pencil} onClick={onEdit}>Edit plate</Button>}
        </div>
      </div>
    </ModalShell>
  );
}

const dieHref = (d: Die) => dieItem(d).href;

function DieRow({ d }: { d: MatchedDie }) {
  return (
    <Link
      href={d.href}
      className="flex items-start gap-3 min-h-11 px-3 py-2 hover:bg-black/[0.03] transition-colors"
    >
      <span className="shrink-0 w-[60px] pt-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)]">
        {d.kind}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--glass-ink)]">
          Location: {d.location || 'not recorded'}
        </span>
        <span className="block text-xs text-[var(--glass-muted)] break-words">
          {d.detail.filter(Boolean).join(' · ')}
          {d.linked && <span className="ml-1 font-semibold text-emerald-700">· Linked</span>}
          {d.status && (
            <span className={cn('ml-1 font-semibold', d.status === 'Damaged' ? 'text-red-700' : 'text-amber-700')}>
              · {d.status}
            </span>
          )}
        </span>
      </span>
    </Link>
  );
}

function Detail({ label, value, mono, wide }: { label: string; value?: string | null; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'col-span-2')}>
      <dt className="text-xs font-medium text-[var(--glass-muted)]">{label}</dt>
      <dd className={cn('text-sm font-semibold text-[var(--glass-ink)] mt-0.5 break-words', mono && 'font-mono')}>
        {value || '—'}
      </dd>
    </div>
  );
}
