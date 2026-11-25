'use client';
// src/components/admin/JobCardForm.tsx
// ============================================================
// A job card: of one Job Separation line, or one made by hand (its order
// details are typed here). Boxes in the printed card's order.
// Everything fills from resolveJobCard (src/lib/jobCard.ts), re-run on each
// pick; only what it can't find is asked for. One card per plate, so a line
// can have several. An issued card is shown as it was frozen.
// ============================================================

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { StateChip } from '@/components/ui/StateChip';
import { ConfirmModal } from '@/components/admin/modals';
import JobCardSheet, { JobCardPrint } from '@/components/admin/JobCardSheet';
import PlateFinder from '@/components/admin/PlateFinder';
import ArtworkBox from '@/components/admin/ArtworkBox';
import { inkColor } from '@/lib/pantone';
import { useParties } from '@/hooks/useReferenceData';
import { colorBoxes, MAX_COLORS } from '@/lib/plateDie';
import {
  JOB_CARD_STATE, artworkRow, cardNumberOf, cardState, dieLabel, materialForPlate, materialOptions, plateUpdates, resolveJobCard,
  type Field, type JobCardInput, type JobCardRow, type JobCardSources, type Layout, type ManualOrder, type OverrideKey, type PrintedCard,
} from '@/lib/jobCard';

const EMPTY: JobCardInput = {
  part_name: null, plate_id: null, die_id: null, flatbed_die_id: null, shade_card_id: null, material_id: null,
  layout: null, roll_sheet: null, direction: null, material: null, material_width_mm: null,
  labels_per_roll: null, delivery_date: null, manual: null, overrides: {},
};
const BLANK_ORDER: ManualOrder = { number: null, party: null, pm_code: null, job_name: null, po_no: null, po_date: null, quantity: null, colors: null };
const inputOf = (c: JobCardRow | undefined, manual = false): JobCardInput =>
  !c && manual ? { ...EMPTY, manual: BLANK_ORDER } : c ? (Object.fromEntries(Object.keys(EMPTY).map((k) => [k, c[k as keyof JobCardInput]])) as JobCardInput) : EMPTY;

const show = (v: unknown): string => (v == null ? '' : String(v));
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const layoutText = (l: Layout) => `${l.across} X ${l.around} · ${l.acrossUps} × ${l.aroundUps} ups · gap ${l.aroundGap}`;

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data;
}

type Can = {
  canManage: boolean;      // job_card_edit: make, issue, reopen
  canEditPlates: boolean;  // dies_plates_edit: colours, gap and die link go to the plate
  canDelete: boolean;      // Admin
};

/** `lineId`: the line's cards. `cardId`: one card, from the Job Cards page;
 *  'new' is a manual card, saved only when it is saved or issued. */
export default function JobCardForm({ lineId, cardId, ...can }: { lineId?: string; cardId?: string } & Can) {
  const { canManage } = can;
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | 'new' | null>(null);
  // A manual card's PM code and plate as typed and picked: what they lead to is loaded as they change.
  const [typedFor, setTypedFor] = useState<{ pm?: string; plate?: string }>({});
  const { data, error, isLoading, refetch } = useQuery<{ sources: JobCardSources }>({
    queryKey: ['job-card', cardId ?? lineId, typedFor],
    placeholderData: keepPreviousData, // the form stays as it is meanwhile
    queryFn: () => send(cardId ? `/api/job-cards/${cardId}?${new URLSearchParams(typedFor)}` : `/api/job-separations/${lineId}/job-card`, 'GET'),
    // A refetch while typing would drop what's typed; saving reloads it.
    refetchOnWindowFocus: false, refetchOnReconnect: false, staleTime: Infinity, gcTime: 0,
  });

  // A lookup that fails while typing must not take the form away.
  const lastGood = useRef<{ sources: JobCardSources }>();
  if (data) lastGood.current = data;
  const shown = data ?? lastGood.current;

  if (isLoading && !shown) return <div className="glass rounded-2xl h-96 animate-pulse motion-reduce:animate-none" role="status" aria-label="Loading job card" />;
  if (!shown) {
    return (
      <div className="glass rounded-2xl p-8 text-center space-y-3" role="alert">
        <p className="text-sm text-[var(--glass-ink)]">{(error as Error | null)?.message ?? 'Could not load the job card'}</p>
        <Button onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  const { sources } = shown;
  const card = cardId ? sources.cards.find((c) => c.id === cardId) : activeId === 'new' ? undefined : sources.cards.find((c) => c.id === activeId) ?? sources.cards[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={cardId ? '/admin/job-cards' : '/admin/job-separation'} className="inline-flex items-center gap-1.5 min-h-11 pr-3 text-sm font-medium text-brand-muted hover:text-brand-ink">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {cardId ? 'Job Cards' : 'Job Separation'}
        </Link>
        {!cardId && sources.cards.length > 0 && (
          <nav aria-label="Cards on this line" className="flex flex-wrap items-center gap-1">
            {sources.cards.map((c) => (
              <button key={c.id} type="button" onClick={() => setActiveId(c.id)} aria-current={c.id === card?.id}
                className={cn('min-h-11 px-3 rounded-lg text-sm font-mono border', c.id === card?.id
                  ? 'border-brand-primary text-brand-ink font-semibold' : 'border-transparent text-brand-muted hover:bg-black/[0.04]')}>
                {cardNumberOf(sources.line.sr_no, c, sources.cards.length)}{c.part_name ? ` · ${c.part_name}` : ''}
              </button>
            ))}
            {canManage && activeId !== 'new' && !sources.line.cancelled_at && (
              <Button size="sm" icon={Plus} onClick={() => setActiveId('new')}>Another card</Button>
            )}
          </nav>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-brand-muted">Couldn’t load the matching records. What you typed is kept. <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold underline underline-offset-2">Try again</button></p>}
      {!card && cardId && cardId !== 'new' ? (
        <p className="glass rounded-2xl p-8 text-center text-sm text-brand-muted">This job card no longer exists.</p>
      ) : !card && !canManage ? (
        <p className="glass rounded-2xl p-8 text-center text-sm text-brand-muted">No job card has been issued for {sources.line.sr_no ?? 'this line'} yet.</p>
      ) : <CardEditor
        {...can}
        key={`${card?.id ?? 'new'}:${card?.updated_at ?? ''}`}
        sources={sources} card={card} isExtra={activeId === 'new'} isNew={cardId === 'new'} onTyped={(t) => setTypedFor((o) => ({ ...o, ...t }))}
        onSaved={async (id) => {
          if (cardId && !id) return router.push('/admin/job-cards'); // deleted
          if (cardId === 'new') return router.replace(`/admin/job-cards/${id}`);
          setTypedFor({});
          await refetch();
          setActiveId(id);
        }}
        onArtwork={refetch}
      />}
    </div>
  );
}

function CardEditor({ canManage, canEditPlates, canDelete, sources, card, isExtra, isNew, onSaved, onArtwork, onTyped }: Can & {
  isNew: boolean; onTyped: (t: { pm?: string; plate?: string }) => void; // a manual card: not saved yet; its PM code or plate changed
  sources: JobCardSources; card: JobCardRow | undefined; isExtra: boolean; onSaved: (id: string | null) => Promise<void>;
  onArtwork: () => Promise<unknown>; // reloads the records; what's typed stays
}) {
  const queryClient = useQueryClient();
  const { line } = sources;
  const saved = inputOf(card, isNew);
  const [input, setInput] = useState<JobCardInput>(saved);
  const [stations, setStations] = useState<string[] | null>(null); // null: as on the plate
  const [acrossGap, setAcrossGap] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'issue' | 'reopen' | 'delete' | 'print' | null>(null);

  // Set once created, so a retry after a failed plate save doesn't make a second card.
  const createdId = useRef(card?.id);

  const set = (patch: Partial<JobCardInput>) => setInput((c) => ({ ...c, ...patch }));
  const override = (key: OverrideKey) => (v: string) => setInput((c) => {
    const overrides = { ...c.overrides };
    if (v) overrides[key] = v; else delete overrides[key];
    return { ...c, overrides };
  });

  // What's typed for the plate counts before it is saved there.
  const live: JobCardSources = { ...sources };
  const basePlate = resolveJobCard(sources, input, card?.id ?? null).plate.value;
  if (basePlate) {
    live.plates = sources.plates.map((p) => (p.id !== basePlate.id ? p : {
      ...p,
      ...(stations && { colors: stations.map((s) => s.trim() || null), total_colors: stations.length }),
      ...(acrossGap != null && { across_gap: acrossGap }),
    }));
  }
  const d = resolveJobCard(live, input, card?.id ?? null);
  // Made by hand and not linked: its order details are typed here, and with
  // no plate it keeps its own colours and artwork.
  const typed = !line.id ? input.manual : null;
  const setManual = (patch: Partial<ManualOrder>) => setInput((c) => ({ ...c, manual: { ...c.manual!, ...patch } }));
  const plate = d.plate.value;
  const issued = card?.issued_at ? card.details : null;
  const state = JOB_CARD_STATE[card ? cardState({ ...card, edited: card.details?.edited ?? null }) : 'none'];
  const number = card
    ? cardNumberOf(line.sr_no, card, sources.cards.length)
    : isNew ? input.manual?.number || 'New job card' : `${line.sr_no ?? ''}${isExtra ? `-${Math.max(0, ...sources.cards.map((c) => c.part)) + 1}` : ''}`;
  // A plate with no material learns it from the card: a pick or the last card's, never a suggestion.
  const newMaterial = canEditPlates && basePlate && !basePlate.material?.trim() && (d.material.source === 'picked' || d.material.source === 'last_card')
    ? materialForPlate(d.material.value, sources) : null;
  const numberBox = !input.manual ? null : card?.card_number ? <Read label="Job card number" f={{ value: card.card_number, source: 'auto' }} />
    : <Typed label="Job card number" f={{ value: input.manual.number, source: 'auto', note: 'Yours to choose, but not like NOV26-55: those are Job Separation’s' }} onCommit={(v) => setManual({ number: v.toUpperCase() || null })} />;
  const dirty = JSON.stringify(input) !== JSON.stringify(saved) || stations !== null || acrossGap !== null;

  const boxes = [d.plateNo, d.labelSize, d.cylinder, d.rollSheet, d.direction, d.shadeCardNumber, d.gap, d.material,
    d.materialWidth, d.metres, d.labelsPerRoll, d.dieNumber, d.colors, d.artwork];
  const gaps = boxes.filter((f) => f.value == null || f.source === 'suggested').length;

  async function run(what: string, work: () => Promise<string | null>, done: string) {
    setBusy(what);
    try {
      const id = await work();
      toast.success(done);
      queryClient.invalidateQueries({ queryKey: ['job-separations'] }); // its colour there
      queryClient.invalidateQueries({ queryKey: ['job-cards'] });
      await onSaved(id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const create = async (from: JobCardInput) => {
    createdId.current = (await send(isNew ? '/api/job-cards' : `/api/job-separations/${line.id}/job-card`, 'POST', from)).card.id as string;
    return createdId.current;
  };

  // The card first: if the plate refuses, the card's own fields are still kept.
  async function save(): Promise<string> {
    let id = createdId.current;
    if (!id) id = await create(input);
    else if (JSON.stringify(input) !== JSON.stringify(saved)) await send(`/api/job-cards/${id}`, 'PATCH', input);
    // Without the plate permission the card keeps its own die; the plate is left alone.
    if (basePlate && canEditPlates) {
      const pickedDie = d.die.source === 'picked' ? d.die.value : null;
      const updates = plateUpdates(basePlate, pickedDie, { colors: stations ?? undefined, acrossGap, material: newMaterial });
      for (const body of updates) await send(`/api/plates/${basePlate.id}`, 'PATCH', body);
      if (updates.length) queryClient.invalidateQueries({ queryKey: ['plates'] });
    }
    return id;
  }

  // Saved at once (a new card: when it is saved): its die, last card and artwork come with it.
  const pickPlate = (id: string | null) => {
    const next = { ...input, plate_id: id, die_id: null, flatbed_die_id: null, layout: null };
    if (isNew && !createdId.current) { // nothing to save yet
      setInput(next);
      onTyped({ plate: id ?? '' });
      return;
    }
    run('plate', async () => {
      if (!createdId.current) return create(next);
      await send(`/api/job-cards/${createdId.current}`, 'PATCH', next);
      return createdId.current;
    }, id ? 'Plate picked, draft saved' : 'Plate taken off, draft saved');
  };

  // A manual card's own colours stand until its plate has some.
  const onCard = !!input.manual && (!plate || (!plate.colors && !!input.manual.colors?.length));

  const stationList = stations ?? (plate?.colors
    ? colorBoxes(plate.colors).slice(0, Math.max(plate.total_colors ?? 0, plate.colors.length)) : []);

  return (
    <section aria-label={`Job card ${number}`} className="glass rounded-2xl overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-black/[0.08]">
        <div className="min-w-0">
          <p className="text-xs text-brand-muted">Job card</p>
          <h1 className="text-[22px] leading-7 sm:text-[28px] sm:leading-9 font-semibold font-mono text-brand-ink">{number}</h1>
          <p className="text-sm text-brand-muted break-words">{[d.party.value, d.jobName.value].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StateChip label={state.label} dot={state.color} className="mr-1" />
          {canDelete && card && <Button intent="danger" onClick={() => setConfirm('delete')} disabled={!!busy}>Delete</Button>}
          {issued ? (
            <>
              {canManage && <Button onClick={() => setConfirm('reopen')} disabled={!!busy}>Reopen</Button>}
              <Button intent="primary" icon={Printer} onClick={async () => { if (await artworkReady(issued)) window.print(); else setConfirm('print'); }} disabled={!!busy}>Print</Button>
            </>
          ) : (
            <>
              <Button onClick={() => run('save', save, 'Draft saved')} busy={busy === 'save'} disabled={!!busy || (!!card && !dirty)}>Save draft</Button>
              <Button intent="primary" onClick={() => setConfirm('issue')} disabled={!!busy || !!line.cancelled_at}>Issue</Button>
            </>
          )}
        </div>
      </header>

      {isNew && <MaybeAnOrder lines={sources.linkable} />}
      {card?.manual && canManage && (
        <LinkOrder card={card} sources={sources} unsaved={dirty && !issued} busy={!!busy}
          onLink={(id) => run('link', async () => { await send(`/api/job-cards/${card.id}`, 'PATCH', id ? { action: 'link', job_separation_id: id } : { action: 'unlink' }); return card.id; }, id ? 'Linked to the order' : 'Unlinked')} />
      )}

      {issued ? <IssuedCard details={issued} card={card!} number={number} /> : (
        <div className="p-4 sm:p-6 space-y-5">
          <p className="text-sm text-brand-muted" aria-live="polite">
            {gaps === 0 ? 'Every box is filled.' : `${gaps} ${gaps === 1 ? 'box needs' : 'boxes need'} you. The rest filled from saved records.`}
          </p>
          {d.warnings.length > 0 && (
            <ul role="alert" className="space-y-1">
              {d.warnings.map((w) => <li key={w}><StateChip label={w} dot="#B45309" className="whitespace-normal" /></li>)}
            </ul>
          )}

          {typed ? (
            <Group title="Order">
              {numberBox}
              <Typed label="Job name" wide f={{ value: typed.job_name, source: 'auto' }} onCommit={(v) => { if (v) setManual({ job_name: v }); else toast.error('A job card needs a job name'); }} />
              <PartyBox value={typed.party} onCommit={(v) => setManual({ party: v || null })} />
              <Typed label="PM code" optional f={{ value: typed.pm_code, source: 'auto' }} onCommit={(v) => { setManual({ pm_code: v || null }); onTyped({ pm: v }); }} />
              <Typed label="Label qty" type="number" optional f={{ value: typed.quantity, source: 'auto' }} onCommit={(v) => setManual({ quantity: v ? Number(v) : null })} />
              <Typed label="PO number" optional f={{ value: typed.po_no, source: 'auto' }} onCommit={(v) => setManual({ po_no: v || null })} />
              <Typed label="PO date" type="date" optional f={{ value: typed.po_date, source: 'auto' }} onCommit={(v) => setManual({ po_date: v || null })} />
              <Typed label="Delivery date" type="date" f={d.deliveryDate} optional onCommit={(v) => set({ delivery_date: v || null })} />
              <Typed label="Card for (front, back, base)" f={d.partName} optional onCommit={(v) => set({ part_name: v || null })} />
            </Group>
          ) : <Group title="Order">
            {numberBox}
            <Read label="Sep. line no" f={d.sepLine} /><Read label="PO number" f={d.poNumber} /><Read label="PO date" f={d.poDate} />
            <Read label="Party" f={d.party} /><Read label="PM code" f={d.pmCode} />
            <Read label="Job name" f={d.jobName} wide /><Read label="Label qty" f={d.labelQty} />
            <Typed label="Delivery date" type="date" f={d.deliveryDate} optional onCommit={(v) => set({ delivery_date: v || null })} />
            <Typed label="Card for (front, back, base)" f={d.partName} optional onCommit={(v) => set({ part_name: v || null })} />
          </Group>}

          <Group title="Plate and die">
            {(sources.plates.length > 1 || d.plate.source === 'missing') && (
              <Choose label="Plate" wide note={d.plate.note} value={plate?.id ?? ''} empty={sources.plates.length ? 'Pick the plate' : 'No plate found'}
                options={sources.plates.map((p) => ({ id: p.id, text: [p.item_name, `${p.cylinder ?? '—'}T`, `at ${p.location ?? '—'}`].filter(Boolean).join(' · ') }))}
                onPick={(id) => { setStations(null); setAcrossGap(null); set({ plate_id: id, die_id: null, flatbed_die_id: null, layout: null }); }} />
            )}
            <PlateFinder key={plate?.id ?? 'none'} label={plate ? 'Find another plate' : 'Find a plate'} busy={!!busy} onPick={(p) => pickPlate(p.id)} />
            {plate && input.plate_id === plate.id && sources.plates.length === 1 && !samePm(plate.pm_code, d.pmCode.value) && (
              <div className="sm:col-span-2 lg:col-span-4 -mt-2"><Button size="sm" disabled={!!busy} onClick={() => pickPlate(null)}>Use no plate</Button></div>
            )}
            <Typed label="Plate no" f={d.plateNo} onCommit={override('plateNo')} />
            {d.layout.options.length > 1 ? (
              <Choose label="Label size" note={d.layout.note} value={d.layout.value ? String(d.layout.options.indexOf(d.layout.value)) : ''} empty="Which way round?"
                options={d.layout.options.map((l, i) => ({ id: String(i), text: layoutText(l) }))}
                onPick={(i) => set({ layout: i ? d.layout.options[Number(i)] : null })} />
            ) : <Typed label="Label size" f={d.labelSize} onCommit={override('labelSize')} />}
            <Typed label="Cylinder - size" f={d.cylinder} onCommit={override('cylinder')} />
            <Typed label="Gap" f={d.gap} onCommit={override('gap')} />
            {d.die.options.length > 0 && (
              <Choose label="Die" wide note={d.die.source === 'last_card' ? 'From last card' : d.die.note} value={d.die.value?.id ?? ''} empty="Pick the die"
                options={d.die.options.map((o) => ({ id: o.id, text: [dieLabel(o), o.die.serial_no, `${o.die.ups ?? '—'} ups`,
                  o.type === 'ROTO' && o.die.status !== 'IN USE' ? o.die.status : null].filter(Boolean).join(' · ') }))}
                onPick={(id) => {
                  const o = d.die.options.find((x) => x.id === id);
                  set({ die_id: o?.type === 'ROTO' ? o.id : null, flatbed_die_id: o?.type === 'FLATBED' ? o.id : null });
                }} />
            )}
            <Typed label="Die type - number" f={d.dieNumber} onCommit={override('dieNumber')} />
            {sources.shadeCards.length > 1 && (
              <Choose label="Shade card" note={d.shadeCard.note} value={d.shadeCard.value?.id ?? ''} empty="Pick the shade card"
                options={d.shadeCard.options.map((c) => ({ id: c.id, text: `${c.shade_card_number ?? '—'} · ${c.product_name}` }))}
                onPick={(id) => set({ shade_card_id: id || null })} />
            )}
            <Typed label="Shade card no" f={d.shadeCardNumber} onCommit={override('shadeCardNumber')} />
          </Group>

          <Group title="Material and rolls">
            <MaterialBox f={d.material} auto={resolveJobCard(live, { ...input, material: null }, card?.id ?? null).material} picked={input.material}
              toPlate={newMaterial} options={materialOptions(sources, plate, d.die.value)} onPick={(v) => set({ material: v })} />
            {canEditPlates && plate && plate.across_gap == null && acrossGap == null && d.layout.value && d.layout.value.acrossUps > 1 && d.materialWidth.source !== 'calc' && (
              <Typed label="Height gap, mm" f={{ value: null, source: 'missing', note: 'Works out the width; saved on the plate' }} type="number" optional
                onCommit={(v) => setAcrossGap(v ? Number(v) : null)} />
            )}
            <Typed label="Material width" type="number" f={d.materialWidth} onCommit={(v) => set({ material_width_mm: v ? Number(v) : null })} />
            <Typed label="Meter" f={d.metres} onCommit={override('metres')} />
            <Choose label="Roll / sheet" note={sourceNote(d.rollSheet)} value={d.rollSheet.value ?? ''} empty="Roll or sheet?"
              options={[{ id: 'ROLL', text: 'ROLL' }, { id: 'SHEET', text: 'SHEET' }]}
              onPick={(v) => set({ roll_sheet: (v || null) as JobCardInput['roll_sheet'] })} />
            <Typed label="Direction" f={d.direction} list={Array.from({ length: 8 }, (_, i) => `UNWIND#${i + 1}`)} onCommit={(v) => set({ direction: v.toUpperCase() || null })} />
            <Typed label="Labels per roll" type="number" f={d.labelsPerRoll} onCommit={(v) => set({ labels_per_roll: v ? Number(v) : null })} />
            <Typed label="Metres per roll" f={d.rollMetres} optional onCommit={override('rollMetres')} />
          </Group>

          <Colours locked={!onCard && !!plate && !canEditPlates} where={onCard ? 'card' : plate ? 'plate' : null} stations={!onCard ? stationList : input.manual!.colors?.map((c) => c ?? '') ?? []}
            onChange={!onCard ? setStations : (s) => setManual({ colors: s.map((c) => c.trim() || null) })} varnish={d.varnish} onVarnish={override('varnish')} />

          <ArtworkBox
            uploadTo={plate ? `/api/plates/${plate.id}/artwork` : card?.manual ? `/api/job-cards/${card.id}/artwork` : null} onCard={!plate}
            waiting={isNew ? 'Save the draft first, then attach the artwork.' : 'Artwork is saved on the plate. Pick the plate first.'}
            artwork={artworkRow(sources.artworks, plate?.id ?? null, card?.id ?? null)} onAttached={onArtwork} />
        </div>
      )}

      {confirm === 'issue' && (
        <ConfirmModal title={`Issue job card ${number}?`} confirmLabel="Issue" busy={busy === 'issue'}
          message={gaps > 0 ? `${gaps} ${gaps === 1 ? 'box is' : 'boxes are'} still empty or unconfirmed and will print blank. The card is then fixed as it is now.` : 'The card is then fixed as it is now. Reopen it to correct anything.'}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run('issue', async () => { const id = await save(); await send(`/api/job-cards/${id}`, 'PATCH', { action: 'issue' }); return id; }, 'Job card issued')} />
      )}
      {confirm === 'print' && (
        <ConfirmModal title="Print without the artwork?" confirmLabel="Print anyway"
          message="The artwork couldn't be loaded: it may have expired, or the connection dropped. To get it back, reload the page, or reopen the card and attach it again."
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); setTimeout(() => window.print(), 300); }} />
      )}
      {confirm === 'reopen' && card && (
        <ConfirmModal title={`Reopen ${number}?`} confirmLabel="Reopen" busy={busy === 'reopen'}
          message="It goes back to a draft with the same number and follows its order, plate, die and shade card again. Printed copies no longer match once it changes."
          onCancel={() => setConfirm(null)}
          onConfirm={() => run('reopen', async () => { await send(`/api/job-cards/${card.id}`, 'PATCH', { action: 'reopen' }); return card.id; }, 'Job card reopened')} />
      )}
      {confirm === 'delete' && card && (
        <ConfirmModal title={`Delete job card ${number}?`} tone="danger" confirmLabel="Delete job card" busy={busy === 'delete'}
          message={card.card_number
            ? `This can't be undone. Destroy any printed copy: ${number} becomes free for a new card. The order, plate, die and shade card stay, and the Activity Log keeps a record.`
            : "This can't be undone. Only this draft goes: the order, plate, die and shade card stay."}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run('delete', async () => { await send(`/api/job-cards/${card.id}`, 'DELETE'); return null; }, 'Job card deleted')} />
      )}
    </section>
  );
}

const samePm = (a: string | null | undefined, b: unknown) => (a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** True once the copy that prints has its artwork, or needs none. */
async function artworkReady(card: PrintedCard): Promise<boolean> {
  if (!card.artwork) return true;
  const art = document.querySelector<HTMLImageElement>('#job-card-print-root .jc-artwork img');
  return art ? art.decode().then(() => true, () => false) : false;
}

// ── Boxes ─────────────────────────────────────────────────────
const SOURCE_TEXT: Record<Field<unknown>['source'], string> = {
  auto: '', calc: 'Calculated', picked: 'Entered here', last_card: 'From last card', suggested: 'Suggested: confirm it', choose: 'Choose', missing: '',
};
function sourceNote(f: Field<unknown>): string | undefined {
  if (f.source === 'last_card') return `From ${f.note ?? 'last card'}`;
  return f.note ?? (SOURCE_TEXT[f.source] || undefined);
}

const boxCls = 'w-full min-h-11 rounded-lg border border-black/[0.14] bg-white px-3 text-sm font-mono text-brand-ink outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-brand-ink mb-2">{title}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-3">{children}</div>
    </fieldset>
  );
}

function Label({ children, needs }: { children: React.ReactNode; needs?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 mb-1 text-xs font-medium text-brand-muted">
      {needs && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#B45309]" />}
      {children}{needs && <span className="sr-only">, needs filling</span>}
    </span>
  );
}

const Note = ({ children }: { children?: React.ReactNode }) =>
  (children ? <span className="block mt-1 text-xs text-brand-muted">{children}</span> : null);

/** From the line itself: corrected on Job Separation, not here. */
function Read({ label, f, wide }: { label: string; f: Field<unknown>; wide?: boolean }) {
  const v = show(f.value);
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <Label>{label}</Label>
      <p className="min-h-11 flex items-center text-sm font-mono text-brand-ink break-words">{isoDate.test(v) ? formatNumericDate(v) : v || '—'}</p>
    </div>
  );
}

/** A filled value that can be typed over. Commits on leaving the box; cleared,
 *  it goes back to what fills itself. */
function Typed({ label, f, onCommit, type = 'text', wide, optional, list, action }: {
  label: string; f: Field<unknown>; onCommit: (v: string) => void; type?: 'text' | 'number' | 'date';
  wide?: boolean; optional?: boolean; list?: string[]; action?: { text: string; run: () => void };
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const suggested = f.source === 'suggested';
  const shown = suggested ? '' : show(f.value);
  const needs = !optional && shown === '';
  const listId = `jc-${label.replace(/\W+/g, '-')}`;
  const commit = () => {
    if (typing !== null && typing.trim() !== shown) onCommit(typing.trim());
    setTyping(null);
  };
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <label className="block">
        <Label needs={needs}>{label}</Label>
        <input
          className={boxCls} type={type} value={typing ?? shown} list={list?.length ? listId : undefined}
          min={type === 'number' ? 0 : undefined} step={type === 'number' ? 'any' : undefined}
          onFocus={() => setTyping(shown)} onChange={(e) => setTyping(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
        <Note>{sourceNote(f)}</Note>
      </label>
      {list && list.length > 0 && <datalist id={listId}>{Array.from(new Set(list)).map((v) => <option key={v} value={v} />)}</datalist>}
      {action && <Button size="sm" className="mt-1" onClick={action.run}>{action.text}</Button>}
    </div>
  );
}

const OTHER = '\u0000other';

/** The material, picked from what the records say or typed. The first choice
 *  fills itself; another holds for this card only, unless the plate has none. */
function MaterialBox({ f, auto, picked, toPlate, options, onPick }: {
  toPlate: string | null; // saved on the plate with the card
  f: Field<string>; auto: Field<string>; picked: string | null; options: { group: string; names: string[] }[]; onPick: (v: string | null) => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);
  const filled = auto.source === 'suggested' ? null : auto.value;
  const listed = options.some((g) => g.names.includes(picked ?? ''));
  const commit = () => { if (typing?.trim()) onPick(typing.trim()); setTyping(null); };
  return (
    <div className="min-w-0 sm:col-span-2">
      <label className="block">
        <Label needs={!picked && !filled}>Material (substrate)</Label>
        <select className={boxCls} value={typing !== null ? OTHER : picked ?? ''}
          onChange={(e) => {
            if (e.target.value === OTHER) return setTyping(picked ?? filled ?? '');
            setTyping(null);
            onPick(e.target.value || null);
          }}>
          <option value="">{filled ?? 'Pick the material'}</option>
          {picked && !listed && <option value={picked}>{picked}</option>}
          {options.map((g) => {
            // The one that fills itself is already the first choice.
            const names = g.names.filter((n) => n !== filled || n === picked);
            return names.length > 0 && (
              <optgroup key={g.group} label={g.group}>{names.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>
            );
          })}
          <option value={OTHER}>Type another…</option>
        </select>
      </label>
      {typing !== null && (
        <input className={cn(boxCls, 'mt-1')} aria-label="Type the material" autoFocus value={typing} maxLength={200}
          onChange={(e) => setTyping(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setTyping(null); }} />
      )}
      <Note>{picked && filled && picked !== filled ? `Picked for this card. The first choice goes back to ${filled}` : sourceNote(f)}</Note>
      {toPlate && <Note>{`Also saved on the plate as ${toPlate}`}</Note>}
      {f.source === 'suggested' && <Button size="sm" className="mt-1" onClick={() => onPick(f.value)}>Use {f.value}</Button>}
    </div>
  );
}

/** Offers the party list, so the same customer isn't spelt three ways. */
function PartyBox({ value, onCommit }: { value: string | null; onCommit: (v: string) => void }) {
  const { data: parties } = useParties();
  return <Typed label="Party" optional f={{ value, source: 'auto' }} list={parties?.map((p) => p.name)} onCommit={onCommit} />;
}

function Choose({ label, value, options, empty, onPick, note, wide }: {
  label: string; value: string; options: { id: string; text: string }[]; empty: string; onPick: (id: string) => void; note?: string; wide?: boolean;
}) {
  return (
    <label className={cn('block min-w-0', wide && 'sm:col-span-2')}>
      <Label needs={!value}>{label}</Label>
      <select className={boxCls} value={value} onChange={(e) => onPick(e.target.value)}>
        <option value="">{empty}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
      </select>
      <Note>{note}</Note>
    </label>
  );
}

/** The edge of the box in its ink's colour, as the printed box will be filled. */
const swatch = (name: string): React.CSSProperties | undefined => {
  const ink = inkColor(name);
  return ink ? { backgroundImage: `linear-gradient(90deg, ${ink.background} 10px, transparent 10px)`, paddingLeft: 20 } : undefined;
};

/** Stations in press order, saved on the plate so the next order has them. */
function Colours({ locked, where, stations, onChange, varnish, onVarnish }: {
  locked: boolean; where: 'plate' | 'card' | null; stations: string[]; onChange: (s: string[]) => void; varnish: Field<unknown>; onVarnish: (v: string) => void;
}) {
  const resize = (n: number) => onChange(colorBoxes(stations.length ? stations : null).slice(0, n));
  const blanks = stations.filter((s) => !s.trim()).length;
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-brand-ink mb-2">Colours and varnish</legend>
      {!where ? <p className="text-sm text-brand-muted">Colours are saved on the plate. Pick the plate first.</p> : stations.length === 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="inline-flex items-center gap-1.5 text-sm text-brand-muted">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#B45309]" /> No colours on this {where} yet.
          </p>
          {locked ? <p className="text-sm text-brand-muted">Whoever manages plates can add them.</p>
            : <Button icon={Plus} onClick={() => resize(4)}>Add colours, starting with CMYK</Button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <label className="block">
              <Label>Total colours</Label>
              <select className={boxCls} disabled={locked} value={stations.length} onChange={(e) => resize(Number(e.target.value))}>
                {Array.from({ length: MAX_COLORS }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            {stations.map((s, i) => (
              <label key={i} className="block min-w-0">
                <Label needs={!s.trim()}>Col-{i + 1}</Label>
                <input className={cn(boxCls, 'uppercase')} disabled={locked} value={s} style={swatch(s)}
                  onChange={(e) => onChange(stations.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} />
              </label>
            ))}
            <Typed label="Varnish" f={varnish} optional onCommit={onVarnish} />
          </div>
          <Note>{where === 'card' ? 'Saved on this card: its plate has none.' : locked ? 'From the plate: whoever manages plates can change them.' : 'Saved on the plate for the next order.'}{blanks ? ` ${blanks} still blank.` : ''} NVZ-GL, NVZ, FULL-GL and GLOSS print in the Varnish box. A known Pantone fills its box with a screen colour, close but not for matching.</Note>
        </>
      )}
    </fieldset>
  );
}

/** Before a manual card is made: the orders that may need it instead. */
function MaybeAnOrder({ lines }: { lines: JobCardSources['linkable'] }) {
  if (lines.length === 0) return null;
  return (
    <div role="status" className="px-4 sm:px-6 py-3 border-b border-amber-200 bg-amber-50 text-sm text-amber-900">
      <p className="font-semibold">This PM code is in Job Separation. If it’s one of these orders, make its card there: more fills itself.</p>
      <ul className="mt-1 space-y-0.5">
        {lines.slice(0, 5).map((l) => (
          <li key={l.id}>
            <Link href={`/admin/job-separation/${l.id}/job-card`} className="inline-flex min-h-8 items-center gap-1 underline underline-offset-2">
              {[l.sr_no ?? 'No number', l.party, l.po_no && `PO ${l.po_no}`, l.material_name].filter(Boolean).join(' · ')}
            </Link>
            {l.cards > 0 && <span> · already has {l.cards === 1 ? 'a card' : `${l.cards} cards`}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A card made by hand: which order it turned out to be. */
function LinkOrder({ card, sources, unsaved, busy, onLink }: {
  card: JobCardRow; sources: JobCardSources; unsaved: boolean; busy: boolean; onLink: (lineId: string | null) => void;
}) {
  const { line, linkable } = sources;
  if (line.id) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-6 py-3 border-b border-black/[0.08] text-sm text-brand-ink">
        <span>Made by hand, linked to order{' '}
          <Link href={`/admin/job-separation?q=${encodeURIComponent(line.sr_no ?? '')}`} className="font-mono font-semibold underline underline-offset-2">{line.sr_no ?? 'without a number'}</Link>.
        </span>
        <Button size="sm" disabled={busy} onClick={() => onLink(null)}>Unlink</Button>
      </div>
    );
  }
  if (linkable.length === 0) return null;
  return (
    <section aria-label="Orders this card may be for" className="px-4 sm:px-6 py-3 border-b border-black/[0.08]">
      <p className="text-sm font-semibold text-brand-ink">Is it one of these orders?</p>
      <p className="text-xs text-brand-muted">Same PM code in Job Separation. Linking keeps the number {card.card_number ?? 'typed here'} and shows the card on that order.{unsaved ? ' Save the draft first.' : ''}</p>
      <ul className="mt-2 rounded-lg border border-black/[0.08] divide-y divide-black/[0.06]">
        {linkable.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 text-sm text-brand-ink break-words">
              <span className="font-mono font-semibold">{l.sr_no ?? '—'}</span> · {[l.party, l.po_no && `PO ${l.po_no}`, l.material_name, l.quantity != null && `${l.quantity.toLocaleString('en-IN')} labels`].filter(Boolean).join(' · ')}
              {l.cards > 0 && <span className="font-semibold text-amber-800"> · already has {l.cards === 1 ? 'a card' : `${l.cards} cards`}</span>}
            </span>
            <Button size="sm" disabled={busy || unsaved} onClick={() => onLink(l.id)}>Link</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The card exactly as issued: the sheet that prints. */
function IssuedCard({ details, card, number }: { details: PrintedCard; card: JobCardRow; number: string }) {
  return (
    <div className="p-4 sm:p-6 space-y-4">
      <p className="text-sm text-brand-muted">
        Issued {card.issued_at ? formatNumericDate(card.issued_at) : ''} by {details.preparedBy}. Later changes to the plate, die or shade card don’t alter it.
      </p>
      {/* A fixed-width sheet: it scrolls sideways inside its own box on a phone. */}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Job card sheet">
        <div className="mx-auto w-fit border border-black/[0.08] bg-white p-3"><JobCardSheet number={number} card={details} /></div>
      </div>
      <JobCardPrint number={number} card={details} />
    </div>
  );
}
