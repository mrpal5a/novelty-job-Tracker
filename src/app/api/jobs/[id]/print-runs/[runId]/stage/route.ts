// src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts
// ============================================================
// POST — advance a print run (release) through its stages:
//   In Printing → Slitting → Quality Check → Packing →
//   Ready to Dispatch → Dispatched   (strictly sequential, 6 stages)
//
// On Dispatched:
//   - print_run.status = 'dispatched', dispatched_at = now
//   - jobs.total_qty_dispatched += qty_this_run
//   - best-effort email notification to the client
// Every change is appended to print_run_stage_logs.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { RELEASE_STAGE_ORDER, RELEASE_STAGE_DEPTS } from '@/lib/constants/stages';
import type { ReleaseStage } from '@/lib/constants/stages';

type Params = { params: Promise<{ id: string; runId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id, runId } = await params;
  const supabase = await createServerSupabaseClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dept = parseDepartment(user.user_metadata?.department);
  if (!dept) return NextResponse.json({ error: 'Invalid department in token' }, { status: 403 });

  const body: { new_stage?: string; notes?: string } = await request.json();
  const newStage = body.new_stage;

  if (!newStage || !(RELEASE_STAGE_ORDER as readonly string[]).includes(newStage)) {
    return NextResponse.json(
      { error: `new_stage must be one of: ${RELEASE_STAGE_ORDER.join(', ')}` },
      { status: 400 }
    );
  }

  // After validation, narrow to ReleaseStage for type-safe indexing.
  const validatedStage = newStage as ReleaseStage;

  // ── Department permission ──
  if (dept !== 'Admin' && !RELEASE_STAGE_DEPTS[validatedStage].includes(dept)) {
    return NextResponse.json(
      { error: `${dept} department cannot set run stage to "${validatedStage}"` },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  // ── Fetch run + verify it belongs to this job ──
  const { data: run, error: runError } = await admin
    .from('print_runs')
    .select('*')
    .eq('id', runId)
    .eq('job_id', id)
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: 'Print run not found for this job' }, { status: 404 });
  }
  if (run.status === 'dispatched') {
    return NextResponse.json({ error: 'This run is already dispatched' }, { status: 400 });
  }

  // ── Strict sequential progression ──
  const currentIdx = RELEASE_STAGE_ORDER.indexOf(run.current_stage as ReleaseStage);
  const targetIdx  = RELEASE_STAGE_ORDER.indexOf(validatedStage);

  if (targetIdx !== currentIdx + 1) {
    return NextResponse.json(
      {
        error: `Invalid progression: "${run.current_stage}" → "${validatedStage}". ` +
               `Next stage must be "${RELEASE_STAGE_ORDER[currentIdx + 1] ?? 'none — run is complete'}".`,
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  // ── Update the run ──
  const runUpdate: Record<string, unknown> = { current_stage: validatedStage };
  if (validatedStage === 'Dispatched') {
    runUpdate.status        = 'dispatched';
    runUpdate.dispatched_at = now;
  }

  const { data: updatedRun, error: updateError } = await admin
    .from('print_runs')
    .update(runUpdate)
    .eq('id', runId)
    .select()
    .single();

  if (updateError) {
    console.error('[POST print-run stage] update run:', updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // ── On dispatch: add this run's qty to the job total ──
  if (validatedStage === 'Dispatched') {
    const { data: job } = await admin
      .from('jobs')
      .select('total_qty_dispatched, job_name, po_number, party')
      .eq('id', id)
      .single();

    await admin
      .from('jobs')
      .update({ total_qty_dispatched: (job?.total_qty_dispatched ?? 0) + run.qty_this_run })
      .eq('id', id);

    // Per-release client notification on dispatch (best-effort — never blocks).
    try {
      const origin = request.nextUrl.origin;
      await fetch(`${origin}/api/notifications/email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_id:    id,
          job_name:  job?.job_name ?? null,
          po_number: job?.po_number ?? '',
          party:     job?.party ?? '',
          status:    'Dispatched' as const,
          remark:    `Release #${run.run_number} dispatched — ${run.qty_this_run} labels.`,
          qty:       run.qty_this_run,
        }),
      });
    } catch {
      // notification failure must not fail the stage update
    }
  }

  // ── Audit log ──
  await admin
    .from('print_run_stage_logs')
    .insert({
      print_run_id: runId,
      stage:        validatedStage,
      changed_by:   user.id,
      notes:        body.notes?.trim() || null,
    });

  return NextResponse.json({ print_run: updatedRun });
}
