'use client';
// src/components/admin/DiePicker.tsx
// The roto dies offered for a plate. Pointing at one (or reaching it with the
// keyboard) shows the die's record in a small card beside the row; clicking
// picks it. A phone has no pointer to hover with, so there the picked die's
// record opens under the list instead.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatAdminDate, formatNumericDate } from '@/lib/utils';
import { StateChip } from '@/components/ui/StateChip';
import { layoutPair, materialKey, sameMaterial, type DieUps } from '@/lib/plateDie';
import type { Die } from '@/lib/types';
import { STATUS_DOT, STATUS_LABEL } from './DieDetailModal';

const CARD_W = 300;
const GAP = 10;

function DieFacts({ die }: { die: Die }) {
  const facts: [string, string | number | null, boolean?][] = [
    ['Location', die.location],
    ['Serial no', die.serial_no?.toUpperCase() ?? null, true],
    ['Size', [die.length, die.width].filter(Boolean).join(' × ') || null, true],
    ['Cylinder', die.cylinder, true],
    ['Corner', die.corner],
    ['Shape', die.shape],
    ['Labels / round', die.ups, true],
    ['First used', die.die_received_on ? formatNumericDate(die.die_received_on) : null, true],
    ['Height', layoutPair(die.across_ups, die.across_gap), true],
    ['Width', layoutPair(die.around_ups, die.around_gap), true],
    ['Added', formatAdminDate(die.created_at), true],
    ['Added by', die.created_by],
  ];
  return (
    <>
      <p className="text-sm font-semibold break-words">{die.job_name || 'Die'}</p>
      <StateChip label={STATUS_LABEL[die.status] ?? die.status} dot={STATUS_DOT[die.status]} className="mt-1 text-xs" />
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
        <div className="col-span-2 min-w-0">
          <dt className="text-[11px] text-brand-muted">Material</dt>
          <dd className="text-[13px] font-semibold break-words">{die.material || 'Not recorded'}</dd>
        </div>
        {facts.map(([label, value, mono]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] text-brand-muted">{label}</dt>
            <dd className={cn('text-[13px] font-semibold break-words', mono && 'font-mono')}>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      {die.status === 'DAMAGE' && (
        <p className="mt-2.5 text-xs text-red-800 break-words">
          {[die.damage_date && formatNumericDate(die.damage_date), die.damage_reason || 'No reason recorded'].filter(Boolean).join(' · ')}
        </p>
      )}
    </>
  );
}

// One card at a time: hovering a row puts away the focused row's card.
let closeShown: (() => void) | null = null;

/** Wraps a row; its die's card shows while the row is hovered or focused. */
export function DieHover({ die, children, className }: { die: Die; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const hide = () => setRect(null);
  const show = () => {
    closeShown?.();
    closeShown = hide;
    setRect(ref.current?.getBoundingClientRect() ?? null);
  };
  const open = rect !== null;

  // The row moves under a scroll: the card follows it.
  useEffect(() => {
    if (!open) return;
    const move = () => setRect(ref.current?.getBoundingClientRect() ?? null);
    window.addEventListener('scroll', move, true);
    window.addEventListener('resize', move);
    return () => {
      window.removeEventListener('scroll', move, true);
      window.removeEventListener('resize', move);
    };
  }, [open]);

  return (
    <div
      ref={ref}
      className={className}
      // Move, not enter: a card that went away under a still pointer (a click,
      // a scroll) comes back as soon as the pointer moves on the row.
      onPointerMove={(e) => { if (!open && e.pointerType !== 'touch') show(); }}
      onPointerLeave={hide}
      onFocus={(e) => { if (e.target.matches(':focus-visible')) show(); }}
      // A click on the row moves focus; the pointer is still on it.
      onBlur={() => { if (!ref.current?.matches(':hover')) hide(); }}
    >
      {children}
      {rect && createPortal(
        <div
          aria-hidden="true"
          // Never off the bottom or top of the window, however tall the record.
          ref={(el) => {
            if (!el) return;
            const top = el.offsetTop;
            const fit = Math.max(8, Math.min(top, window.innerHeight - el.offsetHeight - 8));
            if (fit !== top) { el.style.top = `${fit}px`; el.style.bottom = 'auto'; }
          }}
          style={place(rect, ref.current?.closest('[role=dialog]')?.getBoundingClientRect() ?? rect)}
          className="anim-drop pointer-events-none fixed z-[60] rounded-[14px] border border-brand-border bg-white p-3.5 font-sans text-brand-ink shadow-[0_18px_40px_rgba(12,42,32,0.16),0_2px_6px_rgba(12,42,32,0.06)]"
        >
          <DieFacts die={die} />
        </div>,
        document.body,
      )}
    </div>
  );
}

// Beside the row's dialog where there's room, else above or below it; grows away from
// the nearer screen edge, and the card itself keeps within the window.
function place(r: DOMRect, box: DOMRect): React.CSSProperties {
  const upward = r.top > window.innerHeight / 2;
  const right = box.right + GAP, left = box.left - GAP - CARD_W;
  const beside = right + CARD_W <= window.innerWidth - 8 ? right : left >= 8 ? left : null;
  return {
    width: CARD_W,
    left: beside ?? Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8)),
    ...(upward
      ? { bottom: window.innerHeight - (beside !== null ? r.bottom : r.top - 6) }
      : { top: beside !== null ? r.top : r.bottom + 6 }),
  };
}

type Props = {
  found: DieUps;
  material: string;        // the plate's, to say how each die compares
  value: string;           // die_id, '' when not linked
  linked?: Die;            // the linked die's record, which may not be in `found`
  onPick: (die: Die | null) => void;
};

export default function DiePicker({ found, material, value, linked, onPick }: Props) {
  const name = useId();
  const inList = found.dies.some((d) => d.id === value);
  // The die linked when the form opened leads the list; later picks stay put.
  const [savedId] = useState(value);
  const all = linked && !inList ? [linked, ...found.dies] : found.dies;
  const rows = [...all.filter((d) => d.id === savedId), ...all.filter((d) => d.id !== savedId)];

  const compare = (d: Die): string | null =>
    d.id === value && !inList ? 'Other size or cylinder'
      : !materialKey(material) ? null
      : sameMaterial(d.material, material) ? 'Same material'
      : materialKey(d.material) ? 'Other material' : 'Material not recorded';

  return (
    <>
      <div className="relative max-h-64 overflow-y-auto rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] divide-y divide-black/[0.06]">
        <Row name={name} checked={!value} onPick={() => onPick(null)}>
          <span className="text-sm text-[var(--glass-ink)]">Not linked</span>
        </Row>
        {rows.map((d) => {
          const note = compare(d);
          return (
            <DieHover key={d.id} die={d}>
              <Row name={name} checked={d.id === value} onPick={() => onPick(d)}>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-[var(--glass-ink)]">
                    Location {d.location || 'not recorded'}
                    {d.serial_no && <span className="font-mono text-xs font-medium">{d.serial_no.toUpperCase()}</span>}
                    {d.id === savedId && <span className="text-xs text-emerald-800">Linked</span>}
                    {d.status !== 'IN USE' && <StateChip label={STATUS_LABEL[d.status] ?? d.status} dot={STATUS_DOT[d.status]} className="text-xs" />}
                  </span>
                  <span className="block text-xs text-[var(--glass-muted)] break-words">
                    {[note !== 'Material not recorded' && d.material, d.ups != null && `${d.ups} ups`].filter(Boolean).join(' · ')}
                    {note && (
                      <span className={cn('font-semibold', note === 'Same material' && 'text-emerald-800')}>
                        {(d.material && note !== 'Material not recorded') || d.ups != null ? ' · ' : ''}{note}
                      </span>
                    )}
                  </span>
                </span>
              </Row>
            </DieHover>
          );
        })}
      </div>
      {linked && (
        <div className="mt-2 hidden rounded-lg border border-black/[0.08] bg-white p-3 text-brand-ink [@media(hover:none)]:block">
          <DieFacts die={linked} />
        </div>
      )}
    </>
  );
}

function Row({ name, checked, onPick, children }: { name: string; checked: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <label className={cn(
      'flex items-center gap-3 min-h-11 px-3 py-2 cursor-pointer transition-colors',
      checked ? 'bg-brand-surface-hover' : 'hover:bg-black/[0.03]',
    )}>
      <input type="radio" name={name} checked={checked} onChange={onPick} className="h-4 w-4 shrink-0 accent-[#10553F]" />
      {children}
    </label>
  );
}
