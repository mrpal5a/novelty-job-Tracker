'use client';
// src/components/admin/ArtworkBox.tsx
// The artwork of a job card's plate, on the card's form: choose, drop or
// paste a picture or PDF, crop it, attach it. Saved on the plate at once, so
// the next order of it has it already; a manual card with no plate keeps its own.

import { useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Check, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { ConfirmModal, ModalShell } from '@/components/admin/modals';
import { ARTWORK_DAYS, WHOLE, type ArtworkRow, type Crop } from '@/lib/artwork';
import { ARTWORK_ACCEPT, artworkBlob, openArtwork, type OpenFile, type OpenPage } from '@/lib/artworkFile';

/** A dropped connection reaches us as a TypeError ("Failed to fetch"). */
const errorText = (e: unknown) => (e instanceof TypeError ? 'Network error. Check the connection and try again' : (e as Error).message);

export default function ArtworkBox({ uploadTo, onCard, waiting, artwork, onAttached }: {
  uploadTo: string | null; // where it is sent; null: not yet, for the reason in `waiting`
  onCard: boolean;         // kept on the card, not a plate
  waiting: string; artwork: ArtworkRow | undefined; onAttached: () => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [opening, setOpening] = useState(false);
  const [over, setOver] = useState(false);
  const [broken, setBroken] = useState<string | null>(null); // the id that didn't load
  const [removing, setRemoving] = useState<'ask' | 'busy' | null>(null);
  const stored = artwork && !artwork.removed_at;

  async function open(chosen: File | undefined) {
    if (!chosen || !uploadTo || opening) return;
    setOpening(true);
    try {
      setFile(await openArtwork(chosen));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOpening(false);
      if (input.current) input.current.value = ''; // the same file can be chosen again
    }
  }

  async function remove() {
    if (!artwork) return;
    setRemoving('busy');
    try {
      const res = await fetch(`/api/artworks/${artwork.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to remove the artwork');
      toast.success('Artwork removed');
      await onAttached();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setRemoving(null);
    }
  }

  // Ctrl+V anywhere on the form, when what's copied is a picture.
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; });
  useEffect(() => {
    if (!uploadTo || file || removing) return;
    const onPaste = (e: ClipboardEvent) => {
      if (document.querySelector('[role=dialog]')) return; // Issue, Delete… is being asked
      const pasted = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
      if (!pasted) return;
      e.preventDefault();
      openRef.current(pasted);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [uploadTo, file, removing]);

  // A file dropped beside the box would open in the tab and lose what's typed.
  useEffect(() => {
    const stay = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', stay);
    window.addEventListener('drop', stay);
    return () => { window.removeEventListener('dragover', stay); window.removeEventListener('drop', stay); };
  }, []);

  return (
    <fieldset>
      <legend className="text-sm font-semibold text-brand-ink mb-2">Artwork</legend>
      {!uploadTo ? <p className="text-sm text-brand-muted">{waiting}</p> : (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); open(e.dataTransfer.files[0]); }}
          className={cn('flex flex-col sm:flex-row sm:items-center gap-4 rounded-lg border border-dashed p-3 transition-colors',
            over ? 'border-brand-primary bg-brand-surface-hover' : 'border-black/[0.2]')}
        >
          {stored && broken === artwork.id && <p role="alert" className="text-sm text-brand-muted">The picture couldn’t be loaded. Reload the page to try again.</p>}
          {stored && broken !== artwork.id && (
            // eslint-disable-next-line @next/next/no-img-element -- a private link next/image can't fetch
            <img onError={() => setBroken(artwork.id)} src={`/api/artworks/${artwork.id}`} alt={`Artwork: ${artwork.file_name}`} width={artwork.width} height={artwork.height}
              className="max-h-40 w-auto max-w-full sm:max-w-[45%] object-contain border border-black/[0.08] bg-white" />
          )}
          <div className="min-w-0 space-y-2">
            <p className="text-sm text-brand-ink break-words">
              {stored ? artwork.file_name
                : artwork ? `Artwork removed on ${formatNumericDate(artwork.removed_at)}. Attach it again to print it.`
                : 'No artwork yet.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button icon={ImagePlus} busy={opening} disabled={opening} onClick={() => input.current?.click()}>
                {opening ? 'Opening…' : stored ? 'Replace artwork' : 'Attach artwork'}
              </Button>
              {stored && <Button intent="danger" icon={Trash2} disabled={opening} onClick={() => setRemoving('ask')}>Remove</Button>}
            </div>
            <p className="text-xs text-brand-muted">
              PNG, JPG or PDF. Drop it here, or paste a copied picture. Saved on {onCard ? 'this card' : 'the plate'} and kept {ARTWORK_DAYS} days after it was last opened.
            </p>
          </div>
          <input ref={input} type="file" accept={ARTWORK_ACCEPT} className="hidden" aria-label="Artwork file"
            onChange={(e) => open(e.target.files?.[0])} />
        </div>
      )}
      {removing && (
        <ConfirmModal title="Remove this artwork?" tone="danger" confirmLabel="Remove artwork" busy={removing === 'busy'}
          message={onCard ? "It comes off this card. This can't be undone, but it can be attached again." : "It comes off this plate, so new job cards of it have no artwork. This can't be undone, but it can be attached again. Job cards already issued keep theirs until it expires."}
          onCancel={() => setRemoving(null)} onConfirm={remove} />
      )}
      {file && uploadTo && (
        <CropModal file={file} uploadTo={uploadTo}
          onClose={() => { file.close(); setFile(null); }}
          onDone={async () => { file.close(); setFile(null); await onAttached(); }} />
      )}
    </fieldset>
  );
}

const EDGES = ['left', 'top', 'right', 'bottom'] as const;

function CropModal({ file, uploadTo, onClose, onDone }: {
  file: OpenFile; uploadTo: string; onClose: () => void; onDone: () => Promise<void>;
}) {
  const titleId = useId();
  const [pageNo, setPageNo] = useState(1);
  const [page, setPage] = useState<OpenPage | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop>(WHOLE);
  const [saving, setSaving] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let gone = false, opened: OpenPage | null = null;
    setPage(null); setFailed(null); setCrop(WHOLE);
    file.page(pageNo).then(
      (p) => { if (gone) p.close(); else { opened = p; setPage(p); } },
      (e: Error) => { if (!gone) setFailed(e.message); },
    );
    return () => { gone = true; opened?.close(); };
  }, [file, pageNo]);

  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const part = (v: number) => Math.min(1, Math.max(0, v));
    return { x: part((e.clientX - r.left) / r.width), y: part((e.clientY - r.top) / r.height) };
  };
  const drag = (e: React.PointerEvent) => {
    if (!start.current) return;
    const a = start.current, b = at(e);
    const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
    if (w > 0.02 && h > 0.02) setCrop({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w, h });
  };

  // The same rectangle as four numbers, for the keyboard: % cut off each edge.
  const cut = { left: crop.x, top: crop.y, right: 1 - crop.x - crop.w, bottom: 1 - crop.y - crop.h };
  const setCut = (edge: (typeof EDGES)[number], percent: number) => {
    const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' } as const;
    const next = { ...cut, [edge]: Math.min(0.98 - cut[opposite[edge]], Math.max(0, (percent || 0) / 100)) };
    setCrop({ x: next.left, y: next.top, w: 1 - next.left - next.right, h: 1 - next.top - next.bottom });
  };

  async function attach() {
    if (!page || sending.current) return; // a fast double-click beats the disabled button
    sending.current = true;
    setSaving(true);
    try {
      const canvas = await page.draw(crop);
      const blob = await artworkBlob(canvas);
      const form = new FormData();
      form.set('file', new File([blob], 'artwork', { type: blob.type }));
      form.set('name', file.name);
      form.set('width', String(canvas.width));
      form.set('height', String(canvas.height));
      const res = await fetch(uploadTo, { method: 'POST', body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Failed to save the artwork');
      toast.success(`Artwork attached (${Math.round(blob.size / 1024)} KB)`);
      await onDone();
    } catch (e) {
      toast.error(errorText(e));
      sending.current = false;
      setSaving(false);
    }
  }

  const pct = (v: number) => `${v * 100}%`;
  return (
    <ModalShell titleId={titleId} onClose={saving ? undefined : onClose}>
      <div className="flex flex-col max-h-[85vh]">
        <div className="px-5 py-4 border-b border-black/[0.08] shrink-0">
          <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)]">Crop the artwork</h2>
          <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">Drag over the part to print. {file.name}</p>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {file.pages > 1 && (
            <label className="block text-xs font-medium text-[var(--glass-muted)]">
              Page
              <select value={pageNo} disabled={saving} onChange={(e) => setPageNo(Number(e.target.value))}
                className="ml-2 min-h-11 rounded-lg border border-black/[0.14] bg-white px-3 text-sm font-mono text-[var(--glass-ink)]">
                {Array.from({ length: file.pages }, (_, i) => <option key={i} value={i + 1}>{i + 1} of {file.pages}</option>)}
              </select>
            </label>
          )}
          {failed ? <p role="alert" className="text-sm text-red-800">{failed}</p>
            : !page ? <p role="status" className="py-16 text-center text-sm text-[var(--glass-muted)]">Opening the page…</p> : (
              <>
                <div className="flex justify-center bg-black/[0.04] rounded-lg p-2">
                  <div ref={area} className="relative overflow-hidden cursor-crosshair touch-none select-none"
                    onPointerDown={(e) => { if (saving) return; e.currentTarget.setPointerCapture(e.pointerId); start.current = at(e); }}
                    onPointerMove={drag}
                    onPointerUp={(e) => { drag(e); start.current = null; }}
                    onPointerCancel={() => { start.current = null; }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local file */}
                    <img src={page.preview} alt="" draggable={false} className="block max-h-[46vh] max-w-full bg-white" />
                    <div aria-hidden="true" className="pointer-events-none absolute border-2 border-[#10553F] shadow-[0_0_0_9999px_rgba(12,42,32,0.45)]"
                      style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {EDGES.map((edge) => (
                    <label key={edge} className="block text-xs font-medium text-[var(--glass-muted)]">
                      <span className="capitalize">{edge}</span> %
                      <input type="number" min={0} max={98} step={1} value={Math.round(cut[edge] * 100)} disabled={saving}
                        aria-label={`Cut off the ${edge}, percent`} onChange={(e) => setCut(edge, Number(e.target.value))}
                        className="mt-1 w-full min-h-11 rounded-lg border border-black/[0.14] bg-white px-2 text-sm font-mono text-[var(--glass-ink)]" />
                    </label>
                  ))}
                </div>
                <Button size="sm" disabled={saving} onClick={() => setCrop(WHOLE)}>Use the whole page</Button>
              </>
            )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-black/[0.08] shrink-0">
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button intent="primary" icon={Check} onClick={attach} busy={saving} disabled={saving || !page}>
            {saving ? 'Attaching…' : 'Attach artwork'}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
