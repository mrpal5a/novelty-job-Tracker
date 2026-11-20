'use client';
// src/components/admin/LayoutFields.tsx
// The label layout as a small grid: one row Height (across), one row Width
// (around), columns Size · Ups · Gap. Ups and gaps are shared between a plate and its roto die
// (migration 101 keeps the two in step). Both forms pass their sizes in for
// the first column: the plate its across/around sizes, the die its length
// (across) and width (around). Units sit in the column headers, which keeps three
// boxes side by side at phone width.

import React from 'react';
import { cn } from '@/lib/utils';
import type { DieLayout } from '@/lib/types';

export type LayoutState = Record<keyof DieLayout, string>;

export function layoutState(from?: Partial<DieLayout> | null): LayoutState {
  const s = (v: number | null | undefined) => (v == null ? '' : String(v));
  return {
    around_ups: s(from?.around_ups), around_gap: s(from?.around_gap),
    across_ups: s(from?.across_ups), across_gap: s(from?.across_gap),
  };
}

type Side = 'across' | 'around';
// Height first, as everywhere else (height × width). The plate's width gap
// is worked out from the width row's size and ups (and the cylinder above
// the grid), so the box it fills is the last one.
const SIDES: { side: Side; label: string }[] = [
  { side: 'across', label: 'Height' },
  { side: 'around', label: 'Width' },
];

type Props = {
  value: LayoutState;
  onChange: (next: LayoutState) => void;
  inputClassName: string;
  /** The record's own sizes, as the first column. */
  sizes?: Record<Side, string> & { required?: boolean; onChange: (side: Side, value: string) => void };
  /** Boxes currently holding a worked-out value: tinted and tagged "auto". */
  auto?: Partial<Record<keyof DieLayout, boolean>>;
  note?: React.ReactNode;
};

const headCls = 'text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)]';

export default function LayoutFields({ value, onChange, inputClassName, sizes, auto, note }: Props) {
  const box = cn(inputClassName, 'font-mono min-w-0');
  const set = (key: keyof DieLayout, v: string) => onChange({ ...value, [key]: v });

  return (
    <fieldset>
      <legend className="sr-only">Label layout: size, ups and gap, by height and width</legend>
      <div className={cn('grid items-center gap-x-2 gap-y-2', sizes ? 'grid-cols-[auto_1fr_1fr_1fr]' : 'grid-cols-[auto_1fr_1fr]')}>
        <span aria-hidden="true" />
        {sizes && (
          <span aria-hidden="true" className={headCls}>
            Size mm{sizes.required && <span className="text-red-300 ml-0.5">*</span>}
          </span>
        )}
        <span aria-hidden="true" className={headCls}>Ups</span>
        <span aria-hidden="true" className={headCls}>Gap mm</span>

        {SIDES.map(({ side, label }) => (
          <React.Fragment key={side}>
            <span className={cn(headCls, 'pr-1')}>{label}</span>
            {sizes && (
              <input
                aria-label={`${label} in mm`}
                aria-required={sizes.required || undefined}
                inputMode="decimal"
                value={sizes[side]}
                onChange={(e) => sizes.onChange(side, e.target.value)}
                className={box}
              />
            )}
            <input
              aria-label={`${label} ups`}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={value[`${side}_ups`]}
              onChange={(e) => set(`${side}_ups`, e.target.value)}
              className={box}
            />
            <div className="relative min-w-0">
              <input
                aria-label={`${label} gap in mm${auto?.[`${side}_gap`] ? ', worked out' : ''}`}
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={value[`${side}_gap`]}
                onChange={(e) => set(`${side}_gap`, e.target.value)}
                className={cn(box, auto?.[`${side}_gap`] && 'pr-10 !bg-[var(--glass-bg-strong)]')}
              />
              {auto?.[`${side}_gap`] && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] font-semibold uppercase tracking-[0.06em] text-emerald-700"
                >
                  auto
                </span>
              )}
            </div>
          </React.Fragment>
        ))}
      </div>
      {note && <p className="text-[11px] text-[var(--glass-muted)] mt-1.5" aria-live="polite">{note}</p>}
    </fieldset>
  );
}
