'use client';
// src/components/admin/AddPlateModal.tsx
// Recording a plate, or correcting one already recorded.
//
// PM code comes first: on a new plate it fills the party and item name from
// Job Separation. The rest follows the Prepress spreadsheet's order. Only
// the party is required — a plate is often entered before its serial is
// etched or its rack decided.

import React, { useState, useId, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import { useUnchanged, NOTHING_CHANGED } from '@/hooks/useUnchanged';
import type { Die, Plate } from '@/lib/types';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';
import { usePmCodeLookup, fillIfUntouched } from '@/hooks/usePmCodeLookup';
import { dieListQuery } from '@/lib/listQueries';
import DiePicker from './DiePicker';
import PartySuggestInput from './PartySuggestInput';
import { colorBoxes, dieUpsFor, widthGapMm, labelsPerRound, commonValues, LAYOUT_KEYS } from '@/lib/plateDie';
import LayoutFields, { layoutState, type LayoutState } from './LayoutFields';
import { useAutoFill } from '@/hooks/useAutoFill';

const NO_DIES: Die[] = [];
const COLOR_COUNTS = Array.from({ length: 12 }, (_, i) => i + 1);

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Props = {
  editing?: Plate;
  onClose: () => void;
  onSaved: () => void;
};

export default function AddPlateModal({ editing, onClose, onSaved }: Props) {
  const titleId = useId();
  const listId  = useId();

  const [party,         setParty]         = useState(editing?.party ?? '');
  const [pmCode,        setPmCode]        = useState(editing?.pm_code ?? '');
  const [itemName,      setItemName]      = useState(editing?.item_name ?? '');
  const [acrossSize,    setAcrossSize]    = useState(editing?.across_size ?? '');
  const [aroundSize,    setAroundSize]    = useState(editing?.around_size ?? '');
  const [cylinder,      setCylinder]      = useState(editing?.cylinder?.toString() ?? '');
  const [material,      setMaterial]      = useState(editing?.material ?? '');
  const [plateId,       setPlateId]       = useState(editing?.plate_id ?? '');
  const [plateDate,     setPlateDate]     = useState(editing?.plate_date ?? '');
  const [labelPerRound, setLabelPerRound] = useState(editing?.label_per_round?.toString() ?? '');
  const [location,      setLocation]      = useState(editing?.location ?? '');
  const [totalColors,   setTotalColors]   = useState(editing?.total_colors?.toString() ?? '');
  // All 12 boxes live here; Total colours decides how many show and save.
  const [colors,        setColors]        = useState(() => colorBoxes(editing?.colors));
  const colorCount = Number(totalColors) || 0;
  const [dieId,         setDieId]         = useState(editing?.die_id ?? '');
  const [layout,        setLayout]        = useState<LayoutState>(() => layoutState(editing));
  const [saving,        setSaving]        = useState(false);

  // PM code → its Job Separation line: party and item name fill in, spelt
  // the way the worksheet and the party list spell them. New plates only.
  const lastFill = useRef({ party: '', item: '' });
  const pmMatch = usePmCodeLookup(pmCode, !editing, (row) => {
    const prev = lastFill.current;
    lastFill.current = { party: row.party ?? '', item: row.material_name ?? '' };
    setParty(fillIfUntouched(party, prev.party, lastFill.current.party));
    setItemName(fillIfUntouched(itemName, prev.item, lastFill.current.item));
  });

  // Sizes + cylinder + material → the dies cut for them. The die library is
  // cached by the list page; it also gives the material spellings in use.
  const diesQuery = useQuery(dieListQuery());
  const allDies = diesQuery.data ?? NO_DIES;
  const materials = useMemo(() => commonValues(allDies, 'material'), [allDies]);
  const dieUps = useMemo(
    () => dieUpsFor(allDies, acrossSize, aroundSize, cylinder, material),
    [allDies, acrossSize, aroundSize, cylinder, material],
  );
  const sized = parseFloat(acrossSize) > 0 && parseFloat(aroundSize) > 0 && parseFloat(cylinder) > 0;

  // Width gap follows cylinder, width ups and width size; label per round
  // is height ups × width ups. A value typed by hand stays (useAutoFill).
  const autoGap = widthGapMm(cylinder, layout.around_ups, aroundSize);
  useAutoFill(autoGap, layout.around_gap, (v) => setLayout((l) => ({ ...l, around_gap: v })));
  const autoLpr = labelsPerRound(layout.across_ups, layout.around_ups);
  useAutoFill(autoLpr, labelPerRound, setLabelPerRound);
  // Picking a die brings its layout in, when it has one; the database then
  // keeps plate and die in step (migration 101).
  function pickDie(die: Die | null) {
    setDieId(die?.id ?? '');
    if (die && LAYOUT_KEYS.some((k) => die[k] != null)) setLayout(layoutState(die));
  }

  // Each line the team enters is its own etched plate ID; drop blank
  // lines from stray Enters and store the rest newline-joined.
  const plateIdNormalized = plateId.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  // What Save sends; an edit saved with none of it changed stays local.
  const values = {
    party:           party.trim(),
    pm_code:         pmCode.trim(),
    item_name:       itemName.trim(),
    across_size:     acrossSize.trim(),
    around_size:     aroundSize.trim(),
    cylinder,
    material:        material.trim(),
    plate_id:        plateIdNormalized,
    plate_date:      plateDate,
    label_per_round: labelPerRound,
    location:        location.trim(),
    total_colors:    totalColors,
    colors:          colorCount ? colors.slice(0, colorCount) : null,
    die_id:          dieId,
    ...layout,
  };
  const { unchanged } = useUnchanged(values);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (editing && unchanged) { toast(NOTHING_CHANGED); onClose(); return; }

    if (!party.trim()) {
      toast.error('Enter the party this plate belongs to');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(editing ? `/api/plates/${editing.id}` : '/api/plates', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to save plate');
        return;
      }
      toast.success(editing ? 'Plate updated' : 'Plate added');
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
              {editing ? 'Edit plate' : 'Add plate'}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              Only the party is required — fill in the rest as it becomes known
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <PlateLabel>PM code</PlateLabel>
              <input
                value={pmCode}
                onChange={(e) => setPmCode(e.target.value)}
                autoComplete="off"
                autoFocus={!editing}
                aria-label="PM code"
                className={cn(inputCls, 'font-mono')}
              />
              {!editing && pmMatch && (
                <p className="text-[11px] text-[var(--glass-muted)] mt-1" aria-live="polite">
                  {pmMatch === 'none'
                    ? 'Not in Job Separation: enter party and item by hand.'
                    : `Party and item filled from Job Separation${pmMatch.sr_no ? ` ${pmMatch.sr_no}` : ''}.`}
                </p>
              )}
            </div>
            <div>
              <PlateLabel required>Party</PlateLabel>
              <WithExample example="DHANUKA - SANAND">
                <PartySuggestInput value={party} onChange={setParty} className={inputCls} />
              </WithExample>
            </div>
          </div>

          <div>
            <PlateLabel>Item name</PlateLabel>
            <input
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              className={inputCls}
            />
          </div>

          {/* What the plate runs on comes first: the gap below is worked out from it. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.7fr_1fr] gap-3">
            <div>
              <PlateLabel>Cylinder</PlateLabel>
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
              <PlateLabel>Material</PlateLabel>
              <WithExample example="80GSM CHROMO + LAMINATION">
                <input
                  value={material}
                  onChange={(e) => setMaterial(e.target.value)}
                  list={listId}
                  autoComplete="off"
                  aria-label="Material"
                  className={inputCls}
                />
              </WithExample>
              <datalist id={listId}>{materials.map((m) => <option key={m} value={m} />)}</datalist>
            </div>
            <label className="block">
              <PlateLabel>Total colours</PlateLabel>
              <select
                value={totalColors}
                onChange={(e) => setTotalColors(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              >
                <option value="">Not set</option>
                {COLOR_COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          {/* One box per colour, numbered in station order. */}
          {colorCount > 0 && (
            <fieldset>
              <legend className="sr-only">Colours, in station order</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {colors.slice(0, colorCount).map((color, i) => (
                  <div key={i} className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-[11px] font-semibold text-[var(--glass-muted)]"
                    >
                      {i + 1}
                    </span>
                    <input
                      aria-label={`Colour ${i + 1}`}
                      value={color}
                      onChange={(e) => setColors((all) => all.map((c, j) => (j === i ? e.target.value : c)))}
                      autoComplete="off"
                      className={cn(inputCls, 'pl-8')}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          <LayoutFields
            value={layout}
            onChange={setLayout}
            inputClassName={inputCls}
            auto={{ around_gap: autoGap !== null && layout.around_gap === String(autoGap) }}
            sizes={{
              across: acrossSize,
              around: aroundSize,
              onChange: (side, v) => (side === 'across' ? setAcrossSize : setAroundSize)(v),
            }}
            note={<>
              {autoGap !== null && layout.around_gap === String(autoGap) && (
                <>Width gap {autoGap} = {cylinder} × 3.175 ÷ {layout.around_ups} − {aroundSize}. </>
              )}
              {dieId
                ? 'Ups and gaps are shared with the linked roto die and every plate on it.'
                : 'Link a roto die below to share ups and gaps with it.'}
            </>}
          />

          {/* Found from the sizes, cylinder and material above. */}
          <fieldset>
            <legend><PlateLabel>Roto die</PlateLabel></legend>
            <DiePicker
              found={dieUps}
              material={material}
              value={dieId}
              linked={allDies.find((d) => d.id === dieId)}
              onPick={pickDie}
            />
            <p className="text-[11px] text-[var(--glass-muted)] mt-1" aria-live="polite">
              {!sized ? 'Enter both sizes and the cylinder to list its dies.'
                : diesQuery.isLoading ? 'Looking for the die…'
                : diesQuery.isError ? 'Couldn’t load the dies. Close and open this form to try again.'
                : dieUps.dies.length === 0 ? 'No die of this size and cylinder.'
                : `All dies of this size and cylinder${material.trim() ? ', same material first' : ''}. Hover to see a die, click to link it.`}
            </p>
          </fieldset>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <PlateLabel>Label per round</PlateLabel>
              <input
                type="number"
                inputMode="numeric"
                aria-label="Label per round"
                value={labelPerRound}
                onChange={(e) => setLabelPerRound(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
              <p className="text-[11px] text-[var(--glass-muted)] mt-1" aria-live="polite">
                {autoLpr === null
                  ? 'Fills in from height ups × width ups.'
                  : labelPerRound === String(autoLpr)
                    ? `${layout.across_ups} × ${layout.around_ups} = ${autoLpr} (height ups × width ups).`
                    : `Typed by hand; height ups × width ups is ${autoLpr}.`}
              </p>
            </div>
            <div>
              <PlateLabel>Location</PlateLabel>
              <WithExample example="Rack B2">
                  <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className={inputCls}
                />
              </WithExample>
            </div>
            <div>
              <PlateLabel>Plate date</PlateLabel>
              <input
                type="date"
                value={plateDate}
                onChange={(e) => setPlateDate(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
            </div>
          </div>

          <div>
            <PlateLabel>Plate ID</PlateLabel>
            <textarea
              value={plateId}
              onChange={(e) => setPlateId(e.target.value)}
              onKeyDown={(e) => {
                // Enter submits the form, like the single-line fields above;
                // Shift+Enter adds a line for the next etched plate ID.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={3}
              className={cn(inputCls, 'font-mono resize-y')}
            />
            <p className="text-xs text-[var(--glass-muted)] mt-1.5">Etched serial, one per plate. Shift + Enter for the next.</p>
          </div>
        </div>

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
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add plate'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function PlateLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--glass-muted)] mb-1.5">
      {children}
      {required && <span className="text-red-300 ml-0.5" aria-hidden="true">*</span>}
    </span>
  );
}
