'use client';
// src/components/admin/DashboardSummaryCard.tsx

import { cn, formatQty } from '@/lib/utils';
import type { DashboardSummary } from '@/lib/types';

type Props = {
  summary: DashboardSummary | null;
};

export default function DashboardSummaryCard({ summary }: Props) {
  const stats = [
    {
      label:  'Active Jobs',
      value:  summary?.total_active ?? '—',
      color:  'text-[var(--glass-ink)]',
    },
    {
      label:  'On Hold',
      value:  summary?.on_hold_count ?? '—',
      color:  'text-[#9A6510]',
    },
    {
      label:  'Due This Week',
      value:  summary?.due_this_week ?? '—',
      color:  'text-[#1E6FB8]',
    },
    {
      label:  'Dispatched This Month',
      value:  summary?.dispatched_this_month ?? '—',
      color:  'text-[#0B6B43]',
    },
    {
      label:  'On-Time Delivery',
      value:  summary?.on_time_delivery_rate != null
                ? `${summary.on_time_delivery_rate}%`
                : '—',
      color:  'text-[var(--glass-ink)]',
      sub:    'this month',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="glass rounded-2xl px-5 py-4 transition-shadow duration-200 hover:shadow-card-hover"
        >
          <p className="text-[10px] uppercase tracking-wide text-brand-subtle font-medium mb-1.5">{stat.label}</p>
          <p className={cn('text-2xl font-semibold font-mono tabular-nums', stat.color)}>
            {stat.value}
          </p>
          {stat.sub && (
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">{stat.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}
