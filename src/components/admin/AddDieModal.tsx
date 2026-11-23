'use client';
// src/components/admin/AddDieModal.tsx
// Entering a die off the Prepress sheet, or correcting one already entered.
//
// The field order follows the sheet's columns, except cylinder and material
// come before the layout: the width gap is worked out from the cylinder, as
// on the plate form.

import React, { useState, useId, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import { useUnchanged, NOTHING_CHANGED } from '@/hooks/useUnchanged';
import { DIE_STATUSES, type Die, type DieStatus } from '@/lib/types';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';
import { dieListQuery } from '@/lib/listQueries';
import { dieUpsFor, commonValues, labelsPerRound, widthGapMm } from '@/lib/plateDie';
import LayoutFields, { layoutState, type LayoutState } from './LayoutFields';
import { istToday } from '@/lib/jobViews';
import { useAutoFill } from '@/hooks/useAutoFill';

const NO_DIES: Die[] = [];

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: Die;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddDieModal({ editing, onClose, onSaved }: Props) {
  const titleId = useId();
  const listId  = useId();

  // The whole library (already cached by the list page) feeds the pick-lists
  // and the "already have this die" check.
  const allDies = useQuery(dieListQuery()).data ?? NO_DIES;
  const picks = useMemo(() => ({
    material: commonValues(allDies, 'material'),
    corner:   commonValues(allDies, 'corner'),
    shape:    commonValues(allDies, 'shape'),
  }), [allDies]);

  const [jobName,  setJobName]  = useState(editing?.job_name ?? '');
  const [length,   setLength]   = useState(editing?.length ?? '');
  const [width,    setWidth]    = useState(editing?.width ?? '');
  const [cylinder, setCylinder] = useState(editing?.cylinder?.toString() ?? '');
  const [material, setMaterial] = useState(editing?.material ?? '');
  const [ups,      setUps]      = useState(editing?.ups?.toString() ?? '');
  const [shape,    setShape]    = useState(editing?.shape ?? '');
  const [corner,   setCorner]   = useState(editing?.corner ?? '');
  const [serialNo, setSerialNo] = useState(editing?.serial_no ?? '');
  // <input type="date"> only speaks yyyy-MM-dd; the column is a DATE, so the
  // stored value already is one.
  const [receivedOn, setReceivedOn] = useState(editing ? editing.die_received_on ?? '' : istToday());
  const [location, setLocation] = useState(editing?.location ?? '');
  const [status,   setStatus]   = useState<DieStatus>(editing?.status ?? 'IN USE');
  // Only meaningful while status is 'DAMAGE' — cleared server-side otherwise.
  const [damageDate,   setDamageDate]   = useState(editing?.damage_date ?? '');
  const [damageReason, setDamageReason] = useState(editing?.damage_reason ?? '');
  const [layout, setLayout] = useState<LayoutState>(() => layoutState(editing));
  const [saving, setSaving] = useState(false);

  // Label per round = height ups × width ups, as on the plate form; a count
  // typed by hand stays.
  const autoLpr = labelsPerRound(layout.across_ups, layout.around_ups);
  useAutoFill(autoLpr, ups, setUps);
  // Width gap = cylinder × 3.175 ÷ width ups − width, as on the plate form.
  const autoGap = widthGapMm(cylinder, layout.around_ups, width);
  useAutoFill(autoGap, layout.around_gap, (v) => setLayout((l) => ({ ...l, around_gap: v })));
  const gapIsAuto = autoGap !== null && layout.around_gap === String(autoGap);

  // Same cylinder and whole-mm size either way round — the plate matcher's rule.
  const twins = useMemo(
    () => dieUpsFor(allDies, length, width, cylinder).dies.filter((d) => d.id !== editing?.id),
    [allDies, length, width, cylinder, editing?.id],
  );

  // What Save sends; an edit saved with none of it changed stays local.
  const values = {
    job_name:        jobName.trim(),
    length:          length.trim(),
    width:           width.trim(),
    cylinder:        cylinder.trim(),
    material:        material.trim(),
    ups:             ups.trim(),
    shape:           shape.trim(),
    corner:          corner.trim(),
    serial_no:       serialNo.trim(),
    die_received_on: receivedOn,
    location:        location.trim(),
    status,
    damage_date:     status === 'DAMAGE' ? damageDate.trim()   : '',
    damage_reason:   status === 'DAMAGE' ? damageReason.trim() : '',
    ...layout,
  };
  const { unchanged } = useUnchanged(values);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (editing && unchanged) { toast(NOTHING_CHANGED); onClose(); return; }

    if (!jobName.trim())    { toast.error('Enter the job this die was cut for'); return; }
    if (!length.trim())     { toast.error('Enter the height'); return; }
    if (!width.trim())      { toast.error('Enter the width'); return; }
    if (!cylinder.trim())   { toast.error('Enter the cylinder'); return; }
    if (!material.trim())   { toast.error('Enter the material'); return; }
    if (!ups.trim())        { toast.error('Enter the label per round'); return; }
    if (!corner.trim())     { toast.error('Enter the corner radius'); return; }
    if (!serialNo.trim())   { toast.error('Enter the serial no'); return; }
    if (!receivedOn.trim()) { toast.error('Enter the date the die was first used'); return; }
    if (!location.trim())   { toast.error('Enter the die location'); return; }
    if (status === 'DAMAGE' && (!damageDate.trim() || !damageReason.trim())) {
      toast.error('Enter the damage date and reason');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/dies/${editing.id}` : '/api/dies', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save die');
        return;
      }
      toast.success(editing ? 'Die updated' : 'Die added');
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">
              {editing ? 'Edit die' : 'Add die'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Fields follow the Prepress sheet, left to right
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close without saving"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          <div>
            <DieLabel required>Job</DieLabel>
            <WithExample example="DHANUKA TARGA SUPER 250 ML">
                <input
                value={jobName}
                onChange={(e) => setJobName(e.target.value)}
                className={inputCls}
              />
            </WithExample>
          </div>

          {/* What the die runs on comes first: the width gap below is worked out from it. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel required>Cylinder</DieLabel>
              <WithUnit unit="teeth">
                  <input
                  type="number"
                  inputMode="numeric"
                  aria-label="Cylinder in teeth"
                  value={cylinder}
                  onChange={(e) => setCylinder(e.target.value)}
                  className={cn(inputCls, 'font-mono')}
                />
              </WithUnit>
            </div>
            <div>
              <DieLabel required>Material</DieLabel>
              <WithExample example="0.75 CHROMO SILVER">
                  <input
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  list={`${listId}-material`}
                  autoComplete="off"
                  className={inputCls}
                />
              </WithExample>
            </div>
          </div>

          {/* Height = length, Width = width, as on the plate form. */}
          <LayoutFields
            value={layout}
            onChange={setLayout}
            inputClassName={inputCls}
            auto={{ around_gap: gapIsAuto }}
            sizes={{
              across: length,
              around: width,
              required: true,
              onChange: (side, v) => (side === 'across' ? setLength : setWidth)(v),
            }}
            note={<>
              {gapIsAuto && <>Width gap {autoGap} = {cylinder} × 3.175 ÷ {layout.around_ups} − {width}. </>}
              Sizes are required. Ups and gaps are shared with every plate linked to this die.
            </>}
          />

          {twins.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">
                {twins.length === 1 ? 'A die' : `${twins.length} dies`} of this size and cylinder already on record
              </p>
              <ul className="mt-1 space-y-0.5">
                {twins.slice(0, 3).map((d) => (
                  <li key={d.id}>
                    {d.job_name} · {d.location || 'no location'} · {d.status}{d.ups != null && ` · ${d.ups} per round`}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel required>Label per round</DieLabel>
              <input
                type="number"
                inputMode="numeric"
                aria-label="Label per round"
                value={ups}
                onChange={(e) => setUps(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
              <p className="text-[11px] text-[var(--glass-muted)] mt-1" aria-live="polite">
                {autoLpr === null
                  ? 'Fills in from height ups × width ups.'
                  : ups === String(autoLpr)
                    ? `${layout.across_ups} × ${layout.around_ups} = ${autoLpr} (height ups × width ups).`
                    : `Typed by hand; height ups × width ups is ${autoLpr}.`}
              </p>
            </div>
            <div>
              <DieLabel>Shape</DieLabel>
              <WithExample example="ROUND, OVAL, RECTANGLE">
                  <input
                  value={shape}
                  onChange={(e) => setShape(e.target.value)}
                  list={`${listId}-shape`}
                  autoComplete="off"
                  className={inputCls}
                />
              </WithExample>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel required>Corner radius</DieLabel>
              <WithExample example="ROUND, SPECIAL">
                  <input
                  value={corner}
                  onChange={(e) => setCorner(e.target.value)}
                  list={`${listId}-corner`}
                  autoComplete="off"
                  className={inputCls}
                />
              </WithExample>
            </div>
            <div>
              <DieLabel required>Serial no</DieLabel>
              <input
                value={serialNo}
                onChange={(e) => setSerialNo(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <DieLabel required>First used</DieLabel>
              <input
                type="date"
                value={receivedOn}
                onChange={(e) => setReceivedOn(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
            </div>
            <div>
              <DieLabel required>Die location</DieLabel>
              <WithExample example="Rack B2">
                  <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={inputCls}
                />
              </WithExample>
            </div>
          </div>

          <div>
            <DieLabel required>Die status</DieLabel>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as DieStatus)}
              className={cn(inputCls, 'appearance-none')}
            >
              {DIE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {status === 'DAMAGE' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <div>
                <DieLabel required>Damage date</DieLabel>
                <input
                  type="date"
                  value={damageDate}
                  onChange={(e) => setDamageDate(e.target.value)}
                  className={cn(inputCls, 'font-mono')}
                />
              </div>
              <div>
                <DieLabel required>Damage reason</DieLabel>
                <WithExample example="Cracked during mounting">
                    <input
                    value={damageReason}
                    onChange={(e) => setDamageReason(e.target.value)}
                    className={inputCls}
                  />
                </WithExample>
              </div>
            </div>
          )}
        </div>

        {(['material', 'corner', 'shape'] as const).map((k) => (
          <datalist key={k} id={`${listId}-${k}`}>
            {picks[k].map((v) => <option key={v} value={v} />)}
          </datalist>
        ))}

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-white/12 shrink-0">
          <Button
            type="button"
            onClick={onClose}
            disabled={saving}
            >
              Cancel
          </Button>
          <Button
            type="submit"
            intent="primary"
            icon={Check}
            disabled={saving}
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add die'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function DieLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
