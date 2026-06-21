'use client';
// src/components/track/ScheduledReleaseCard.tsx

import { cn, formatShortDate, formatQty } from '@/lib/utils';
import type { DispatchSchedule } from '@/lib/types';

type Props = {
  schedules: DispatchSchedule[];
};

export default function ScheduledReleaseCard({ schedules }: Props) {
  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-[var(--glass-ink)] mb-4">Release Schedule</h3>

      <div className="space-y-2">
        {schedules.map((s) => {
          const isDispatched = s.status === 'Dispatched';
          const isPending    = s.status === 'Pending';

          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center justify-between py-2.5 border-b border-brand-border last:border-0'
              )}
            >
              <div className="flex items-center gap-2.5">
                {/* Status icon */}
                <span className="text-sm shrink-0">
                  {isDispatched ? '✅' : isPending ? '⏳' : '🔵'}
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--glass-ink)]">
                    Release {s.release_number}
                  </p>
                  <p className="text-xs text-[var(--glass-muted)] font-mono">
                    {formatQty(isDispatched ? (s.actual_qty ?? s.planned_qty) : s.planned_qty)} labels
                    {isDispatched && s.actual_date
                      ? ` · dispatched ${formatShortDate(s.actual_date)}`
                      : ` · planned ${formatShortDate(s.planned_date)}`}
                  </p>
                </div>
              </div>

              <span className={cn(
                'text-xs font-medium px-2 py-0.5 rounded-full',
                isDispatched ? 'bg-[#E7F5EE] text-[#0B6B43]' :
                isPending    ? 'bg-brand-surface-2 text-brand-muted'         :
                'bg-[#E8F1FB] text-[#1E6FB8]'
              )}>
                {isDispatched ? 'Dispatched' : isPending ? 'Planned' : 'In Progress'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
