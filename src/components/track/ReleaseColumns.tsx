'use client';
// src/components/track/ReleaseColumns.tsx
// One expandable column per release. Each column shows the 6 production
// stages with the timestamp each was reached (from the client stage-log
// view). Prepress stages are shared and shown once by StagePipeline above.

import { useState } from 'react';
import { cn, formatClientDate, formatQty } from '@/lib/utils';
import { RELEASE_STAGE_ORDER } from '@/lib/constants/stages';
import type { ReleaseStage } from '@/lib/constants/stages';
import type { PrintRun, ClientPrintRunStageLog } from '@/lib/types';

type Props = {
  runs:    PrintRun[];
  runLogs: ClientPrintRunStageLog[];
  totalQty: number | null;
  totalDispatched: number;
};

export default function ReleaseColumns({ runs, runLogs, totalQty, totalDispatched }: Props) {
  // Default-open the most recent (last) release.
  const [openId, setOpenId] = useState<string | undefined>(runs[runs.length - 1]?.id);

  if (runs.length === 0) return null;

  // Map: print_run_id → (stage → first timestamp at that stage)
  const stampMap = new Map<string, Map<string, string>>();
  for (const log of runLogs) {
    if (!stampMap.has(log.print_run_id)) stampMap.set(log.print_run_id, new Map());
    const inner = stampMap.get(log.print_run_id)!;
    if (!inner.has(log.stage)) inner.set(log.stage, log.changed_at); // earliest wins (asc order)
  }

  const remaining = totalQty ? totalQty - totalDispatched : 0;

  return (
    <div className="glass rounded-2xl p-5">
      <h3 className="text-sm font-semibold text-[var(--glass-ink)] mb-1">Releases</h3>
      <p className="text-xs text-[var(--glass-muted)] mb-4">
        This order is delivered in {runs.length} release{runs.length === 1 ? '' : 's'}. Tap a release to see each step.
      </p>

      {/* Horizontally scrollable column strip */}
      <div className="flex gap-3 overflow-x-auto pb-2 snap-x">
        {runs.map((run) => {
          const isOpen      = run.id === openId;
          const isDelivered = run.status === 'dispatched';
          const stamps      = stampMap.get(run.id) ?? new Map<string, string>();

          return (
            <div
              key={run.id}
              className={cn(
                'snap-start shrink-0 rounded-xl border transition-all',
                isOpen ? 'w-72 border-[#16A06A]/40 ring-1 ring-[#16A06A]/20' : 'w-44 border-brand-border',
                'bg-brand-surface-2'
              )}
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? undefined : run.id)}
                className="w-full text-left px-4 py-3"
              >
                <p className="text-sm font-semibold text-[var(--glass-ink)]">Release {run.run_number}</p>
                <p className="text-xs font-mono text-[var(--glass-muted)] mt-0.5">
                  {formatQty(run.qty_this_run)} labels
                </p>
                <span className={cn(
                  'inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full',
                  isDelivered ? 'bg-[#E7F5EE] text-[#0B6B43]' : 'bg-[#E8F1FB] text-[#1E6FB8]'
                )}>
                  {isDelivered ? 'Delivered ✓' : run.current_stage}
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-brand-border pt-3 space-y-2">
                  {RELEASE_STAGE_ORDER.map((stage: ReleaseStage) => {
                    const at      = stamps.get(stage) ?? null;
                    const done    = Boolean(at);
                    const current = !done && run.current_stage === stage && !isDelivered;
                    return (
                      <div key={stage} className="flex items-start gap-2">
                        <span className={cn(
                          'mt-0.5 w-2.5 h-2.5 rounded-full shrink-0',
                          done ? 'bg-green-500' : current ? 'bg-emerald-400 dot-pulse' : 'border border-brand-subtle'
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className={cn(
                            'text-xs font-medium',
                            done ? 'text-[#0B6B43]' : current ? 'text-[var(--glass-ink)]' : 'text-[var(--glass-muted)]'
                          )}>
                            {stage}
                          </p>
                          {at && (
                            <p className="text-[11px] font-mono text-[var(--glass-muted)]">{formatClientDate(at)}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {totalQty ? (
        <p className="text-sm text-[var(--glass-ink)] bg-brand-surface-2 rounded-lg px-3 py-2 mt-3">
          <strong className="font-mono">{formatQty(totalDispatched)}</strong> of{' '}
          <strong className="font-mono">{formatQty(totalQty)}</strong> delivered
          {remaining > 0 ? <> · <strong className="font-mono text-[#9A6510]">{formatQty(remaining)}</strong> remaining</> : ' · complete ✓'}.
        </p>
      ) : null}
    </div>
  );
}
