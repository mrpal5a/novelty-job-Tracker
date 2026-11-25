'use client';
// src/components/admin/JobCardSheet.tsx
// ============================================================
// An issued job card as it prints: the shop's own card, A4 portrait, boxes
// and order as on the CorelDRAW sheet it replaces. The issued view on screen
// is this same sheet, so what's seen is what prints. The artwork of
// its plate fills the space below the boxes, whole and undistorted.
//
// Printing follows SlipsManager: a copy is portalled to <body>, and the print
// styles drop everything else on the page.
// ============================================================

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatNumericDate } from '@/lib/utils';
import { Logo } from '@/components/brand/Logo';
import { useBranding } from '@/components/brand/BrandingProvider';
import { inkColor } from '@/lib/pantone';
import type { PrintedCard } from '@/lib/jobCard';

/** A4 less 8 mm margins, at 96 px to the inch. The same on screen and paper. */
const SHEET_PX = 733;
/** 280 mm: the printed page's own least height, so screen and paper agree. */
const SHEET_MIN_PX = 1058;
/** The card always shows this many colour boxes; more when a plate has more. */
const MIN_COLOR_BOXES = 9;

const text = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatNumericDate(s) : s;
};

function Cell({ label, value, span, size, valueClass, ink }: {
  label: string; value: unknown; span?: string; size?: string; valueClass?: string; ink?: string; // a colour name: fills the box when it is known
}) {
  const v = text(value);
  const fill = ink ? inkColor(ink) : null;
  // Small enough that the longest word is never split across lines.
  const word = Math.max(0, ...v.split(/[\s-]+/).map((w) => w.length));
  const fit = word > 13 || v.length > 40 ? 'text-[12px]' : v.length > 20 ? 'text-[13px]' : 'text-[15px]';
  return (
    <div className={cn('flex min-w-0 flex-col border-b border-r border-[#1F2020]', span)}>
      <dt className={cn('bg-[#1F2020] px-0.5 py-[3px] text-center text-[12px] font-bold uppercase leading-[15px] text-[#FFF04D]', size === 'text-[9px]' && 'text-[10px]')}>{label}</dt>
      <dd className={cn('flex min-h-[29px] flex-1 items-center justify-center px-1 py-1 text-center font-mono font-semibold leading-tight [overflow-wrap:anywhere]',
        size ? cn(size, 'px-0.5') : fit, valueClass)}
        style={fill ? { backgroundColor: fill.background, color: fill.text } : undefined}>{v}</dd>
    </div>
  );
}

export default function JobCardSheet({ number, card: p }: { number: string; card: PrintedCard }) {
  const branding = useBranding();
  const inks = (p.colors as (string | null)[] | null) ?? [];
  const boxes = Array.from({ length: Math.max(MIN_COLOR_BOXES, inks.length) }, (_, i) => inks[i] ?? '');
  const inkSize = boxes.length > 10 ? 'text-[9px]' : 'text-[11px]';
  // A line's only card has the line's own number: it isn't printed twice.
  const ownNumber = number !== p.sepLine;
  const perRoll = [p.labelsPerRoll, p.rollMetres].filter((v) => v != null).join(' / ');

  return (
    <article className="jc-sheet flex flex-col bg-white text-black" style={{ width: SHEET_PX, minHeight: p.artwork ? SHEET_MIN_PX : undefined }} aria-label={`Job card ${number}`}>
      <dl className="grid grid-cols-10 border-l border-t border-[#1F2020]">
        <div className="col-span-4 row-span-3 flex flex-col items-center justify-center gap-2 border-b border-r border-[#1F2020] px-3 py-2">
          <Logo width={240} height={85} priority className="max-h-[80px]" />
          <p className="w-full border-t border-[#10553F] pt-1.5 text-center text-[9px] leading-[12px] text-[#10553F]">
            {branding.returnAddress.split('\n').map((l) => l.trim()).filter(Boolean).join(' ')}
          </p>
        </div>
        <Cell span={ownNumber ? 'col-span-2' : 'col-span-3'} label="Prepared by" value={p.preparedBy} valueClass="uppercase" />
        {ownNumber && <Cell span="col-span-2" label="Job card number" value={number} />}
        <Cell span={ownNumber ? 'col-span-2' : 'col-span-3'} label="Sep. line no" value={p.sepLine} />
        <Cell span="col-span-4" label="PO number" value={p.poNumber} />
        <Cell span="col-span-2" label="PO date" value={p.poDate} />
        <Cell span="col-span-4" label="Party" value={p.party} />
        <Cell span="col-span-2" label="Del. date" value={p.deliveryDate} />

        <Cell span="col-span-2" label="PM code" value={p.pmCode} />
        <Cell span="col-span-6" label="Job name" value={[p.jobName, p.partName && `(${p.partName})`].filter(Boolean).join(' ')} />
        <Cell span="col-span-2" label="Plate no" value={p.plateNo} valueClass="text-[#C62828]" />

        <Cell span="col-span-2" label="Label size" value={p.labelSize} />
        <Cell span="col-span-2" label="Cylinder - size" value={p.cylinder} />
        <Cell span="col-span-2" label="Roll / sheet" value={p.rollSheet} />
        <Cell span="col-span-2" label="Direction" value={p.direction} />
        <Cell span="col-span-2" label="Shade card no" value={p.shadeCardNumber} />

        <Cell span="col-span-2" label="Gap" value={p.gap} />
        <Cell span="col-span-6" label="Material (substrate)" value={p.material} />
        <Cell span="col-span-2" label="Material width" value={p.materialWidth} />

        <Cell span="col-span-2" label="Label qty" value={p.labelQty} />
        <Cell span="col-span-2" label="Meter" value={p.metres} />
        <Cell span="col-span-4" label="Label per roll" value={perRoll} />
        <Cell span="col-span-2" label="Die type - number" value={p.dieNumber} />
      </dl>
      <dl className="grid border-l border-[#1F2020]" style={{ gridTemplateColumns: `repeat(${boxes.length + 1}, minmax(0, 1fr))` }}>
        {boxes.map((c, i) => (
          <Cell key={i} label={`Col-${i + 1}`} value={c} size={inkSize} ink={c} />
        ))}
        <Cell label="Varnish" value={p.varnish} size={inkSize} valueClass={p.varnish ? 'bg-[#EBB7AC] text-[#2A3C8F]' : undefined} />
      </dl>

      {/* A set can carry a dozen IDs: smaller and in two columns, so the artwork keeps its room. */}
      {p.plateId && (
        <p className={cn('whitespace-pre-line text-right font-bold text-[#A23B8C]',
          text(p.plateId).split('\n').length > 4 ? 'mt-3 columns-2 text-[11px] leading-[15px]' : 'mt-6 text-[15px]')}>{text(p.plateId)}</p>
      )}
      <div className={cn('jc-artwork relative flex-1', p.artwork && 'mt-2')}>
        {/* Out of the flow: it takes the space that's left and can't push the card to a second page. */}
        {p.artwork && <Artwork key={p.artwork.id} {...p.artwork} />}
      </div>
    </article>
  );
}

function Artwork({ id, width, height }: { id: string; width: number; height: number }) {
  const [gone, setGone] = useState(false);
  if (gone) {
    return (
      <p className="absolute inset-x-0 top-10 text-center text-sm text-brand-muted print:hidden">
        The artwork couldn’t be loaded. If it has expired, reopen the card, attach it again and issue.
      </p>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a private link next/image can't fetch
    <img src={`/api/artworks/${id}`} alt="Artwork" width={width} height={height} onError={() => setGone(true)}
      className="absolute inset-0 h-full w-full object-contain object-top" />
  );
}

/** The copy that prints. Mounted with the issued card; hidden until then. */
export function JobCardPrint(props: { number: string; card: PrintedCard }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return createPortal(
    <div id="job-card-print-root" aria-hidden="true">
      <style dangerouslySetInnerHTML={{ __html: `
        #job-card-print-root { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; overflow: visible !important; }
          body > *:not(#job-card-print-root) { display: none !important; }
          #job-card-print-root { display: block; }
          #job-card-print-root .jc-sheet { width: 194mm !important; min-height: 280mm; }
          /* The dark label bars and ink boxes are the card, not decoration. */
          #job-card-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }` }} />
      <JobCardSheet {...props} />
    </div>,
    document.body,
  );
}
