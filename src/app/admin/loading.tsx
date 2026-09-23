// src/app/admin/loading.tsx
// Route-level loading state for every /admin page. Most admin pages are
// force-dynamic server components, so without this boundary a tab click
// leaves the previous page on screen until the new one's queries finish —
// which reads as a frozen UI. The header and FAB stack live in the layout,
// so they stay put; only the page body swaps to this skeleton.

import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';

export default function AdminLoading() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-3 w-72 max-w-[60vw]" />
        </div>
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass rounded-2xl p-4 space-y-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-14" />
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-4 space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonText key={i} lines={1} className="py-2" />
        ))}
      </div>
    </div>
  );
}
