'use client';
// src/components/admin/AddPlateModal.tsx
// Recording a plate, or correcting one already recorded.
//
// PM code comes first: on a new plate it fills the party and item name from
// Job Separation. The rest follows the Prepress spreadsheet's order. Only
// the party is required — a plate is often entered before its serial is
// etched or its rack decided.

import React, { useState, useId, useRef, useEffect } from 'react';
import { Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ModalShell } from './modals';
import type { Plate } from '@/lib/types';
import { WithExample, WithUnit } from '@/components/ui/FieldAffix';
import { usePmCodeLookup, fillIfUntouched } from '@/hooks/usePmCodeLookup';
import PartySuggestInput from './PartySuggestInput';
import { dieUpsFor, widthGapMm, LAYOUT_KEYS, type DieUps } from '@/lib/plateDie';
import LayoutFields, { layoutState, type LayoutState } from './LayoutFields';

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

  const [party,         setParty]         = useState(editing?.party ?? '');
  const [pmCode,        setPmCode]        = useState(editing?.pm_code ?? '');
  const [itemName,      setItemName]      = useState(editing?.item_name ?? '');
  const [acrossSize,    setAcrossSize]    = useState(editing?.across_size ?? '');
  const [aroundSize,    setAroundSize]    = useState(editing?.around_size ?? '');
  const [cylinder,      setCylinder]      = useState(editing?.cylinder?.toString() ?? '');
  const [plateId,       setPlateId]       = useState(editing?.plate_id ?? '');
  const [plateDate,     setPlateDate]     = useState(editing?.plate_date ?? '');
  const [labelPerRound, setLabelPerRound] = useState(editing?.label_per_round?.toString() ?? '');
  const [location,      setLocation]      = useState(editing?.location ?? '');
  const [totalColors,   setTotalColors]   = useState(editing?.total_colors?.toString() ?? '');
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

  // Sizes + cylinder → the die cut for them: its ups is this plate's label
  // per round, and the note says which die and where it sits.
  const [dieUps, setDieUps] = useState<DieUps | null>(null);
  const lastUps = useRef('');   // what this lookup last wrote, '' if nothing
  const lprNow = useRef(labelPerRound);
  lprNow.current = labelPerRound;
  useEffect(() => {
    const a = parseFloat(acrossSize), b = parseFloat(aroundSize), cyl = parseFloat(cylinder);
    // Takes back its own fill when the die no longer matches; a typed value stays.
    const refill = (next: string) => {
      const current = lprNow.current;
      if (current.trim() && current !== lastUps.current) return;
      lastUps.current = next;
      setLabelPerRound(next);
    };
    if (!(a > 0 && b > 0 && cyl > 0)) { setDieUps(null); refill(''); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ search: String(Math.trunc(a)), field: 'size' });
        const res = await fetch(`/api/dies?${params.toString()}`);
        if (!res.ok || cancelled) return;
        const found = dieUpsFor((await res.json()).dies ?? [], acrossSize, aroundSize, cylinder);
        if (cancelled) return;
        setDieUps(found);
        refill(found.ups !== null ? String(found.ups) : '');
      } catch {
        // Best-effort: label per round can still be typed.
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [acrossSize, aroundSize, cylinder]);
  const matchedDie = dieUps?.dies[0];

  // Width gap follows cylinder, width ups and width size. Like label per
  // round above, it only replaces its own fill: a gap typed by hand stays.
  // Seeded with the saved plate's sum, so a gap that was worked out still
  // follows a corrected cylinder.
  const layoutNow = useRef(layout);
  layoutNow.current = layout;
  const lastGap = useRef(String(widthGapMm(cylinder, layout.around_ups, aroundSize) ?? ''));
  const autoGap = widthGapMm(cylinder, layout.around_ups, aroundSize);
  useEffect(() => {
    const next = autoGap === null ? '' : String(autoGap);
    const current = layoutNow.current.around_gap;
    if ((current.trim() && current !== lastGap.current) || current === next) return;
    lastGap.current = next;
    setLayout({ ...layoutNow.current, around_gap: next });
  }, [autoGap]);
  const dieChoices = dieUps?.dies ?? [];

  // Picking a die brings its layout in, when it has one; the database then
  // keeps plate and die in step (migration 101).
  function pickDie(id: string) {
    setDieId(id);
    const die = dieChoices.find((d) => d.id === id);
    if (die && LAYOUT_KEYS.some((k) => die[k] != null)) setLayout(layoutState(die));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!party.trim()) {
      toast.error('Enter the party this plate belongs to');
      return;
    }

    setSaving(true);
    try {
      // Each line the team enters is its own etched plate ID; drop blank
      // lines from stray Enters and store the rest newline-joined.
      const plateIdNormalized = plateId
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');

      const res = await fetch(editing ? `/api/plates/${editing.id}` : '/api/plates', {
        method:  editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          party:           party.trim(),
          pm_code:         pmCode.trim(),
          item_name:       itemName.trim(),
          across_size:     acrossSize.trim(),
          around_size:     aroundSize.trim(),
          cylinder,
          plate_id:        plateIdNormalized,
          plate_date:      plateDate,
          label_per_round: labelPerRound,
          location:        location.trim(),
          total_colors:    totalColors,
          die_id:          dieId,
          ...layout,
        }),
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          {/* Found from the sizes and cylinder above. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <PlateLabel>Roto die</PlateLabel>
              <select
                value={dieId}
                onChange={(e) => pickDie(e.target.value)}
                className={inputCls}
              >
                <option value="">Not linked</option>
                {dieId && !dieChoices.some((d) => d.id === dieId) && (
                  <option value={dieId}>Current die (other size)</option>
                )}
                {dieChoices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {[d.serial_no || d.job_name, d.location ? `location ${d.location}` : 'no location', d.status !== 'IN USE' && d.status]
                      .filter(Boolean).join(' · ')}
                  </option>
                ))}
              </select>
              {!dieUps && !dieId && (
                <span className="block text-[11px] text-[var(--glass-muted)] mt-1">
                  Enter both sizes and the cylinder to list its dies.
                </span>
              )}
            </label>
            <div>
              <PlateLabel>Label per round</PlateLabel>
              <input
                type="number"
                inputMode="numeric"
                value={labelPerRound}
                onChange={(e) => setLabelPerRound(e.target.value)}
                className={cn(inputCls, 'font-mono')}
              />
              {dieUps && (
                <p className="text-[11px] text-[var(--glass-muted)] mt-1" aria-live="polite">
                  {!matchedDie
                    ? 'No die of this size and cylinder.'
                    : dieUps.ups !== null
                      ? `${dieUps.ups} ups, from die ${matchedDie.serial_no ?? matchedDie.job_name}${matchedDie.location ? ` · location: ${matchedDie.location}` : ''}.`
                      : dieUps.options.length
                        ? `Dies for this size have ${dieUps.options.join(' or ')} ups: enter yours.`
                        : `Die ${matchedDie.serial_no ?? matchedDie.job_name}${matchedDie.location ? ` · location: ${matchedDie.location}` : ''} has no ups recorded.`}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
