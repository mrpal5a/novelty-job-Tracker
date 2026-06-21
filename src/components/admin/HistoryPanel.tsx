'use client';
// src/components/admin/HistoryPanel.tsx

import { useEffect, useState, useCallback } from 'react';
import { cn, formatAdminDate, formatShortDate, formatQty } from '@/lib/utils';
import { PIPELINE_STAGES, REPEAT_SKIPPED_STAGES } from '@/lib/constants/stages';
import { DEPT_DISPLAY_NAME } from '@/lib/constants/departments';
import type { JobDetail, JobStatusLog, StageComment, DispatchSchedule, PrintRun } from '@/lib/types';
import type { Stage } from '@/lib/constants/stages';
import { RELEASE_STAGE_DEPTS, nextReleaseStage } from '@/lib/constants/stages';
import type { ReleaseStage } from '@/lib/constants/stages';
import type { Department } from '@/lib/constants/departments';
import StageComments from './StageComments';
import { AddReleaseModal } from './modals';
import { SkeletonText } from '@/components/ui/Skeleton';
import toast from 'react-hot-toast';

type Props = {
  jobId:               string;
  jobType:             'New' | 'Repeat' | 'Artwork Changed';
  isScheduledRelease:  boolean;
  dept:                Department;
  refreshKey?:         string;   // pass job.updated_at — re-fetches after status changes
};

export default function HistoryPanel({ jobId, jobType, isScheduledRelease, dept, refreshKey }: Props) {
  const [detail,   setDetail]   = useState<JobDetail | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  // Bumped by the print-runs section after a run changes, so job totals refresh
  const [tick,     setTick]     = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        if (res.ok) setDetail(data.job);
        else setError(data.error);
      } catch {
        setError('Failed to load history');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [jobId, refreshKey, tick]);

  if (loading) {
    return <SkeletonText lines={6} className="py-6" />;
  }

  if (error || !detail) {
    return (
      <div className="py-6 text-sm text-red-500 text-center">
        {error ?? 'Failed to load history'}
      </div>
    );
  }

  const timestampMap = new Map<string, string>(
    detail.stage_timestamps.map((t) => [t.stage, t.completed_at])
  );

  const logMap = new Map<string, JobStatusLog[]>();
  for (const log of detail.status_logs) {
    if (!logMap.has(log.status)) logMap.set(log.status, []);
    logMap.get(log.status)!.push(log);
  }

  const commentMap = new Map<string, StageComment[]>();
  for (const c of detail.stage_comments) {
    if (!commentMap.has(c.stage)) commentMap.set(c.stage, []);
    commentMap.get(c.stage)!.push(c);
  }

  const visiblePipeline: Stage[] = [
    ...PIPELINE_STAGES,
    'On Hold',
  ];

  return (
    <div className="py-4 space-y-6">

      {/* Stage history */}
      <div>
        <h4 className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-3">
          Stage History
        </h4>
        <div className="space-y-0">
          {visiblePipeline.map((stage) => {
            const isSkipped = jobType === 'Repeat' && REPEAT_SKIPPED_STAGES.includes(stage as any);
            const completedAt = timestampMap.get(stage);
            const logs = logMap.get(stage) ?? [];
            const comments = commentMap.get(stage) ?? [];
            const latestLog = logs[logs.length - 1];

            return (
              <div
                key={stage}
                className={cn(
                  'flex items-start gap-3 py-2.5 border-b border-brand-border last:border-0',
                  isSkipped && 'opacity-40'
                )}
              >
                {/* Status dot */}
                <div className="mt-0.5 shrink-0">
                  {isSkipped ? (
                    <div className="w-2 h-2 rounded-full border border-dashed border-brand-subtle" />
                  ) : completedAt ? (
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-brand-primary" />
                  )}
                </div>

                {/* Stage info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      'text-sm font-medium',
                      completedAt ? 'text-[var(--glass-ink)]' : 'text-[var(--glass-muted)]',
                      isSkipped && 'line-through'
                    )}>
                      {stage}
                    </span>
                    {isSkipped && (
                      <span className="text-xs text-[var(--glass-muted)] italic">N/A — Repeat</span>
                    )}
                  </div>

                  {latestLog && (
                    <p className="text-xs text-[var(--glass-muted)] font-mono mt-0.5">
                      {DEPT_DISPLAY_NAME[latestLog.changed_by_dept as Department] ?? latestLog.changed_by_dept}
                      {' · '}
                      {formatAdminDate(latestLog.changed_at)}
                    </p>
                  )}

                  {/* Halt remark */}
                  {stage === 'On Hold' && latestLog?.remark && (
                    <p className="text-xs text-[#9A6510] mt-1">
                      Reason: {latestLog.remark}
                    </p>
                  )}

                  {/* QC remark */}
                  {stage === 'Quality Check' && latestLog?.remark && (
                    <p className="text-xs text-[#1E6FB8] mt-1">
                      QC note: {latestLog.remark}
                    </p>
                  )}

                  {/* Internal stage comments */}
                  {comments.length > 0 && (
                    <div className="mt-1 space-y-1">
                      {comments.map((c) => (
                        <p key={c.id} className="text-xs text-brand-muted bg-brand-surface-2 rounded px-2 py-1">
                          <span className="font-medium">{c.created_by}:</span> {c.comment}
                          <span className="ml-2 opacity-50">{formatAdminDate(c.created_at)}</span>
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Add comment inline */}
                  <StageComments
                    jobId={jobId}
                    stage={stage}
                    dept={dept}
                    existingComments={comments}
                    onCommentAdded={(comment) => {
                      setDetail((current) => {
                        if (!current) return current;

                        return {
                          ...current,
                          stage_comments: [...current.stage_comments, comment],
                        };
                      });
                    }}
                  />
                </div>

                {/* Timestamp */}
                {completedAt && !isSkipped && (
                  <p className="text-xs font-mono text-[var(--glass-muted)] shrink-0">
                    {formatShortDate(completedAt)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Print runs (multi-cycle orders) */}
      <PrintRunsSection
        job={detail}
        dept={dept}
        onChanged={() => setTick((t) => t + 1)}
      />

      {/* Scheduled release table */}
      {isScheduledRelease && detail.dispatch_schedules.length > 0 && (
        <ScheduledReleaseTable
          schedules={detail.dispatch_schedules}
          dept={dept}
          onRefresh={() => {
            // Re-fetch full job detail after a release dispatch
            setDetail(null);
            setLoading(true);
            fetch(`/api/jobs/${jobId}`)
              .then((r) => r.json())
              .then((d) => { if (d.job) setDetail(d.job); })
              .finally(() => setLoading(false));
          }}
        />
      )}
    </div>
  );
}

// ── Print Runs Section ────────────────────────────────────────
// Shown when a job has print runs (multi-cycle orders).
// Each run card shows qty + stage; the active run gets an advance
// button gated by department. When all runs are dispatched and qty
// remains, Production/Admin see "Start Next Print Run".

function PrintRunsSection({
  job,
  dept,
  onChanged,
}: {
  job:       JobDetail;
  dept:      Department;
  onChanged: () => void;
}) {
  const [runs,        setRuns]        = useState<PrintRun[]>([]);
  const [loaded,      setLoaded]      = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [showModal,   setShowModal]   = useState(false);

  const loadRuns = useCallback(async () => {
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs`);
      const data = await res.json();
      if (res.ok) setRuns(data.print_runs ?? []);
    } finally {
      setLoaded(true);
    }
  }, [job.id]);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  if (!loaded) return null;

  const totalQty       = job.label_qty ?? 0;
  const dispatchedQty  = job.total_qty_dispatched ?? 0;
  const remainingQty   = totalQty - dispatchedQty;
  const anyInProgress  = runs.some((r) => r.status === 'in_progress');
  const fullyDelivered = totalQty > 0 && remainingQty <= 0;

  // Admin may add the next release when nothing is in progress, qty remains,
  // and this is a scheduled-release job.
  const canAddRelease =
    job.is_scheduled_release &&
    !anyInProgress &&
    !fullyDelivered &&
    totalQty > 0 &&
    (dept === 'Admin');

  // Hide the whole section for non-scheduled jobs that have no runs.
  if (!job.is_scheduled_release && runs.length === 0) return null;

  async function advanceRun(run: PrintRun) {
    const nextStage = nextReleaseStage(run.current_stage as ReleaseStage);
    if (!nextStage) return;

    setAdvancingId(run.id);
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs/${run.id}/stage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ new_stage: nextStage }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to advance run');
        return;
      }
      toast.success(`Run #${run.run_number} → ${nextStage}`);
      await loadRuns();
      onChanged();   // refresh job totals in the parent panel
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setAdvancingId(null);
    }
  }

  async function addRelease(payload: {
    qty_this_run: number;
    planned_date: string;
    more_runs:    boolean;
  }) {
    try {
      const res  = await fetch(`/api/jobs/${job.id}/print-runs`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add release');
        return;
      }
      toast.success(`Release ${data.print_run.run_number} added — In Printing`);
      await loadRuns();
      onChanged();
    } catch {
      toast.error('Network error. Try again.');
    }
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-3">
        Releases
      </h4>

      <div className="space-y-2">
        {runs.map((run) => {
          const isDone    = run.status === 'dispatched';
          const nextStage  = nextReleaseStage(run.current_stage as ReleaseStage);
          const mayAdvance =
            !isDone && nextStage !== null &&
            (dept === 'Admin' || RELEASE_STAGE_DEPTS[nextStage].includes(dept));

          return (
            <div
              key={run.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border px-4 py-3',
                isDone ? 'border-[#BFE3D0] bg-[#E7F5EE]' : 'glass'
              )}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--glass-ink)]">
                  Release {run.run_number}
                  <span className="ml-2 font-mono text-xs text-[var(--glass-muted)]">
                    {formatQty(run.qty_this_run)} labels
                  </span>
                </p>
                {run.planned_date && (
                  <p className="text-xs text-[var(--glass-muted)] mt-0.5">
                    Delivery: {formatShortDate(run.planned_date)}
                  </p>
                )}
                <p className="text-xs text-[var(--glass-muted)] mt-0.5">
                  Stage: <strong className={isDone ? 'text-[#0B6B43]' : 'text-[var(--glass-ink)]'}>
                    {run.current_stage} {isDone ? '✅' : '🔄'}
                  </strong>
                  {run.dispatched_at && (
                    <span className="ml-2 font-mono">{formatShortDate(run.dispatched_at)}</span>
                  )}
                </p>
                {run.notes && (
                  <p className="text-xs text-[var(--glass-muted)] mt-0.5 truncate">{run.notes}</p>
                )}
              </div>

              {!isDone && nextStage && (
                mayAdvance ? (
                  <button
                    onClick={() => advanceRun(run)}
                    disabled={advancingId === run.id}
                    className={cn(
                      'shrink-0 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors',
                      nextStage === 'Dispatched'
                        ? 'bg-[#E7F5EE] border-[#BFE3D0] text-[#0B6B43] hover:bg-[#D8EFE3]'
                        : 'bg-brand-surface-2 border-brand-border text-brand-ink hover:bg-[#E9EDE9]',
                      'disabled:opacity-40'
                    )}
                  >
                    {advancingId === run.id ? 'Saving…' : `→ ${nextStage}`}
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-[var(--glass-muted)]">
                    🔒 {RELEASE_STAGE_DEPTS[nextStage].join('/')}
                  </span>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="bg-brand-surface-2 border border-brand-border rounded-lg px-3 py-2 flex gap-6 text-xs font-mono mt-2">
        <span>Total: <strong>{formatQty(totalQty)}</strong></span>
        <span className="text-[#0B6B43]">Dispatched: <strong>{formatQty(dispatchedQty)}</strong></span>
        <span className="text-[#9A6510]">Remaining: <strong>{formatQty(remainingQty)}</strong></span>
      </div>

      {/* Fully delivered banner */}
      {fullyDelivered && (
        <div className="mt-2 bg-[#E7F5EE] border border-[#BFE3D0] rounded-lg px-3 py-2">
          <p className="text-xs text-[#0B6B43]">
            ✅ All {formatQty(totalQty)} labels delivered across {runs.length} release{runs.length === 1 ? '' : 's'}.
          </p>
        </div>
      )}

      {/* Add next release */}
      {canAddRelease && (
        <div className="mt-3">
          <button
            onClick={() => setShowModal(true)}
            className="text-xs px-3 py-1.5 rounded-lg bg-brand-primary text-white font-medium hover:bg-brand-primary/90 transition-colors"
          >
            + Add Release
          </button>
        </div>
      )}

      {/* Sequential guard hint */}
      {job.is_scheduled_release && anyInProgress && (
        <p className="mt-2 text-xs text-[var(--glass-muted)]">
          Finish and dispatch the active release before adding the next one.
        </p>
      )}

      {showModal && (
        <AddReleaseModal
          remaining={remainingQty}
          releaseNumber={runs.length + 1}
          onCancel={() => setShowModal(false)}
          onConfirm={(payload) => { setShowModal(false); addRelease(payload); }}
        />
      )}
    </div>
  );
}

// ── Scheduled Release Table ───────────────────────────────────

function ScheduledReleaseTable({
  schedules,
  dept,
  onRefresh,
}: {
  schedules:  DispatchSchedule[];
  dept:       Department;
  onRefresh:  () => void;
}) {
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const totalQty    = schedules.reduce((sum, s) => sum + s.planned_qty, 0);
  const releasedQty = schedules
    .filter((s) => s.status === 'Dispatched')
    .reduce((sum, s) => sum + (s.actual_qty ?? s.planned_qty), 0);
  const remainingQty = totalQty - releasedQty;

  const canDispatch = dept === 'Dispatch' || dept === 'Admin';

  async function handleDispatchRelease(schedule: DispatchSchedule) {
    const qty = window.prompt(
      `Dispatch Release ${schedule.release_number}\nPlanned qty: ${schedule.planned_qty.toLocaleString('en-IN')}\n\nEnter actual qty dispatched:`,
      String(schedule.planned_qty)
    );
    if (!qty || isNaN(Number(qty))) return;

    setDispatchingId(schedule.id);
    try {
      const res = await fetch(`/api/dispatch-schedules/${schedule.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ actual_qty: Number(qty) }),
      });
      if (res.ok) {
        onRefresh();
      } else {
        const data = await res.json();
        alert(data.error ?? 'Failed to dispatch release');
      }
    } finally {
      setDispatchingId(null);
    }
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-[var(--glass-muted)] uppercase tracking-wide mb-3">
        Release Schedule
      </h4>

      <div className="rounded-lg border border-brand-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-brand-surface-2 border-b border-brand-border">
              <th className="px-3 py-2 text-left text-xs text-[var(--glass-muted)]">Release</th>
              <th className="px-3 py-2 text-left text-xs text-[var(--glass-muted)]">Planned Qty</th>
              <th className="px-3 py-2 text-left text-xs text-[var(--glass-muted)]">Planned Date</th>
              <th className="px-3 py-2 text-left text-xs text-[var(--glass-muted)]">Status</th>
              <th className="px-3 py-2 text-left text-xs text-[var(--glass-muted)]">Actual Date</th>
              {canDispatch && <th className="px-3 py-2 text-left text-xs text-[var(--glass-muted)]">Action</th>}
            </tr>
          </thead>
          <tbody>
            {schedules.map((s) => (
              <tr key={s.id} className="border-b border-brand-border last:border-0">
                <td className="px-3 py-2 font-mono text-xs">R{s.release_number}</td>
                <td className="px-3 py-2 font-mono text-xs">{formatQty(s.planned_qty)}</td>
                <td className="px-3 py-2 text-xs">{formatShortDate(s.planned_date)}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    'text-xs px-1.5 py-0.5 rounded font-medium',
                    s.status === 'Dispatched' ? 'bg-[#E7F5EE] text-[#0B6B43]' :
                    s.status === 'In Progress' ? 'bg-[#E8F1FB] text-[#1E6FB8]' :
                    'bg-brand-surface-2 text-brand-muted'
                  )}>
                    {s.status === 'Dispatched' ? '✓ Dispatched' :
                     s.status === 'In Progress' ? 'In Progress' : '⏳ Pending'}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--glass-muted)]">
                  {s.actual_date ? formatShortDate(s.actual_date) : '—'}
                </td>
                {canDispatch && (
                  <td className="px-3 py-2">
                    {s.status !== 'Dispatched' ? (
                      <button
                        onClick={() => handleDispatchRelease(s)}
                        disabled={dispatchingId === s.id}
                        className={cn(
                          'text-xs px-2 py-1 rounded border font-medium transition-colors',
                          'bg-[#E7F5EE] border-[#BFE3D0] text-[#0B6B43] hover:bg-[#D8EFE3]',
                          'disabled:opacity-40'
                        )}
                      >
                        {dispatchingId === s.id ? 'Saving…' : 'Dispatch'}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--glass-muted)]">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals row */}
        <div className="bg-brand-surface-2 border-t border-brand-border px-3 py-2 flex gap-6 text-xs font-mono">
          <span>Total: <strong>{formatQty(totalQty)}</strong></span>
          <span className="text-[#0B6B43]">Released: <strong>{formatQty(releasedQty)}</strong></span>
          <span className="text-[#9A6510]">Remaining: <strong>{formatQty(remainingQty)}</strong></span>
        </div>
      </div>
    </div>
  );
}
