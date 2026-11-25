// src/components/admin/ArtworkStorageCard.tsx
// Settings › Artwork storage. How much of the free 1 GB the job card artwork
// uses, with a warning at 700 MB.

import { createAdminClient } from '@/lib/supabase/admin';
import { allPages } from '@/lib/api/allPages';
import { StateChip } from '@/components/ui/StateChip';
import { ARTWORK_DAYS, STORAGE_LIMIT_BYTES, STORAGE_WARN_BYTES } from '@/lib/artwork';

const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;

export default async function ArtworkStorageCard() {
  const db = createAdminClient();
  const stored = await allPages<{ bytes: number }>((from, to) => db.from('plate_artworks')
    .select('bytes').is('removed_at', null).order('id').range(from, to)).catch(() => null);
  const used = stored?.reduce((sum, a) => sum + a.bytes, 0) ?? 0;
  const full = used >= STORAGE_WARN_BYTES;

  return (
    <section
      id="artwork"
      aria-labelledby="artwork-title"
      className="flex scroll-mt-24 flex-col gap-4 rounded-2xl border border-brand-border bg-white p-5 shadow-[0_2px_8px_rgba(12,42,32,0.04)] sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="artwork-title" className="text-base font-semibold text-brand-ink">Artwork storage</h2>
        <p className="text-[13px] text-brand-muted">
          Job card artwork is kept <span className="font-mono">{ARTWORK_DAYS}</span> days after it was last opened, longer while its order is open.
        </p>
      </div>
      {stored === null ? <p className="text-sm text-brand-muted" role="alert">Couldn’t read the artwork storage.</p> : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-sm text-brand-ink">
            <span className="font-mono font-semibold">{mb(used)}</span> of <span className="font-mono">{mb(STORAGE_LIMIT_BYTES)}</span>,{' '}
            <span className="font-mono">{stored.length}</span> {stored.length === 1 ? 'picture' : 'pictures'}
          </p>
          <StateChip className="ml-auto" label={full ? 'Nearly full' : 'Enough space'} dot={full ? '#D97706' : '#059669'} />
        </div>
      )}
      {full && (
        <p className="rounded-xl bg-brand-surface-alt px-3.5 py-3 text-[13px] leading-relaxed text-brand-muted">
          Past {mb(STORAGE_LIMIT_BYTES)}, new artwork is refused. Keep artwork fewer days or move to a bigger Supabase plan.
        </p>
      )}
    </section>
  );
}
