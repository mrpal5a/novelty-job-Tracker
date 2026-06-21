# Scheduled-Release Multi-Cycle Orders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a scheduled-release job be created with a checkbox + optional first release, have releases added over time (qty + delivery date), run each release through the full production pipeline (In Printing → … → Dispatched) while prepress runs once, and show the client one expandable column per release with per-step timestamps.

**Architecture:** Unify onto the existing `print_runs` system. Each release = one `print_run` row, extended with `planned_qty` + `planned_date` and a 6-stage `current_stage` enum. Per-step timestamps come from the existing `print_run_stage_logs` (exposed to the client portal via a new client-safe view). The disconnected up-front `dispatch_schedules` entry is retired for new scheduled jobs. Sequential rule (one run in progress at a time) is already enforced by the API and is kept.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres + RLS), Tailwind, GSAP, react-hot-toast.

**Testing note:** This project has **no test framework** (scripts are only `dev`/`build`/`lint`; zero test files). Per the codebase's established pattern, each task is verified with `npm run lint`, `npx tsc --noEmit` (type-check), `npm run build`, and concrete manual/SQL checks — not a unit-test suite. Do **not** add a test framework; that is out of scope.

**Conventions already in the codebase (do not change):**
- Run all commands from `novelty-job-Tracker/` (the app root that holds `package.json`).
- Server API routes verify auth with `supabase.auth.getUser()`, then use `createAdminClient()` to bypass RLS for writes.
- Department gating uses `parseDepartment(user.user_metadata?.department)`.
- Stage names are defined ONLY in `src/lib/constants/stages.ts`. Never hardcode them elsewhere.
- Commit after each task. Branch is `feature/premium-light-redesign`.

---

## File Structure

**Create:**
- `supabase/migrations/005_scheduled_release_runs.sql` — extend `print_runs`, add client-safe stage-log view.
- `src/components/track/ReleaseColumns.tsx` — client portal: side-by-side release columns with per-step timestamps.
- `src/components/admin/modals/AddReleaseModal.tsx` — admin: qty + delivery date form (added to existing `modals/index.tsx`).

**Modify:**
- `src/lib/types.ts` — `PrintRun` (+planned fields), `PrintRunStage` (6 values), new `ClientPrintRunStageLog`, `AddJobFormData` first-release field.
- `src/lib/constants/stages.ts` — add `RELEASE_STAGE_ORDER` + `RELEASE_STAGE_DEPTS` + `nextReleaseStage()` (single source of truth shared by API + UI).
- `src/app/api/jobs/[id]/print-runs/route.ts` — accept `planned_qty`/`planned_date`; allow Admin to add a release for scheduled jobs; create at `In Printing`.
- `src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts` — use the 6-stage order + dept map; per-release dispatch notification.
- `src/app/api/jobs/route.ts` — on create, if scheduled + first release supplied, create the first `print_run`; stop writing `dispatch_schedules`.
- `src/components/admin/AddJobForm.tsx` — replace multi-release entry with single optional first release.
- `src/components/admin/HistoryPanel.tsx` — rename the section to "Releases", drive it off `is_scheduled_release`, use the 6-stage map, add the "Add Release" button/modal, block when fully delivered.
- `src/app/track/[po]/page.tsx` — for scheduled jobs, fetch the client-safe stage-log view.
- `src/components/track/TrackJobAccordion.tsx` — render `ReleaseColumns` for scheduled jobs; pass stage logs through the bundle; hide the old StagePipeline print-run block for scheduled jobs.
- `src/components/track/StagePipeline.tsx` — guard the inline "Production Cycles" block to `!is_scheduled_release` (kept for legacy non-scheduled multi-run jobs).

---

## Task 1: Database migration — extend print_runs + client stage-log view

**Files:**
- Create: `supabase/migrations/005_scheduled_release_runs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/005_scheduled_release_runs.sql`:

```sql
-- ============================================================
-- NOVELTY LABELS JOB TRACKING SYSTEM
-- Migration 005: Scheduled-Release multi-cycle runs
-- Run AFTER 004_client_view_print_runs.sql
-- ============================================================
-- Each "release" is a print_run with a planned qty + delivery
-- date, moving through the full 6-stage production pipeline.
-- Per-step timestamps (print_run_stage_logs) are exposed to the
-- client portal through a client-safe view (changed_by + notes
-- stripped).
-- ============================================================

-- ── 1. New columns on print_runs ─────────────────────────────
ALTER TABLE print_runs ADD COLUMN IF NOT EXISTS planned_qty  INTEGER;
ALTER TABLE print_runs ADD COLUMN IF NOT EXISTS planned_date DATE;

-- ── 2. Expand current_stage from 4 to 6 production stages ─────
-- Drop the old CHECK, migrate legacy values, add the new CHECK.
ALTER TABLE print_runs DROP CONSTRAINT IF EXISTS print_runs_current_stage_check;

-- Map any legacy rows to the new vocabulary.
UPDATE print_runs SET current_stage = 'In Printing'   WHERE current_stage = 'Printing';
UPDATE print_runs SET current_stage = 'Quality Check' WHERE current_stage = 'QC';
-- 'Packing' and 'Dispatched' keep the same name.

ALTER TABLE print_runs
  ALTER COLUMN current_stage SET DEFAULT 'In Printing';

ALTER TABLE print_runs
  ADD CONSTRAINT print_runs_current_stage_check
  CHECK (current_stage IN (
    'In Printing', 'Slitting', 'Quality Check',
    'Packing', 'Ready to Dispatch', 'Dispatched'
  ));

-- ── 3. Client-safe view of stage logs (per-step timestamps) ──
-- Strips changed_by (auth user id) and notes (internal).
CREATE OR REPLACE VIEW client_print_run_stage_log_view AS
SELECT
  prsl.id,
  prsl.print_run_id,
  prsl.stage,
  prsl.changed_at
FROM print_run_stage_logs prsl;

ALTER VIEW client_print_run_stage_log_view OWNER TO postgres;
GRANT SELECT ON client_print_run_stage_log_view TO anon;
GRANT SELECT ON client_print_run_stage_log_view TO authenticated;

-- ============================================================
-- Done. Next: TypeScript types (Task 2).
-- ============================================================
```

- [ ] **Step 2: Apply the migration**

Apply it the same way the project applies migrations 001–004: paste the file contents into the Supabase Dashboard → SQL Editor → New Query → Run. (There is no local Supabase CLI configured in this repo.)

- [ ] **Step 3: Verify in SQL Editor**

Run this query and confirm both new columns and the new constraint exist:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'print_runs' AND column_name IN ('planned_qty','planned_date');
-- expect 2 rows

SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conname = 'print_runs_current_stage_check';
-- expect the 6-value CHECK

SELECT * FROM client_print_run_stage_log_view LIMIT 1;
-- expect no error (empty result is fine)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_scheduled_release_runs.sql
git commit -m "feat(db): extend print_runs for scheduled releases + client stage-log view"
```

---

## Task 2: TypeScript types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Update `PrintRunStage` and `PrintRun`**

In `src/lib/types.ts`, replace the existing `PrintRunStage` type and `PrintRun` interface (currently around lines 165–180) with:

```typescript
export type PrintRunStage =
  | 'In Printing'
  | 'Slitting'
  | 'Quality Check'
  | 'Packing'
  | 'Ready to Dispatch'
  | 'Dispatched';
export type PrintRunStatus = 'in_progress' | 'dispatched';

export interface PrintRun {
  id:                  string;
  job_id:              string;
  run_number:          number;          // 1, 2, 3… auto-assigned by DB trigger
  qty_this_run:        number;          // actual qty for this release
  planned_qty:         number | null;   // qty the client notified for this release
  planned_date:        string | null;   // ISO date — this release's delivery date
  qty_remaining_after: number;          // total remaining after this run
  current_stage:       PrintRunStage;
  status:              PrintRunStatus;
  started_at:          string;
  dispatched_at:       string | null;
  notes:               string | null;
  created_at:          string;
}
```

- [ ] **Step 2: Add `ClientPrintRunStageLog`**

Directly below the `PrintRunStageLog` interface in `src/lib/types.ts`, add:

```typescript
// Client-safe stage log (from client_print_run_stage_log_view) —
// powers per-step timestamps in the client portal release columns.
export interface ClientPrintRunStageLog {
  id:           string;
  print_run_id: string;
  stage:        string;
  changed_at:   string;
}
```

- [ ] **Step 3: Replace the up-front releases field on `AddJobFormData`**

In `src/lib/types.ts`, in the `AddJobFormData` interface, replace this line:

```typescript
  scheduled_releases?: ScheduledReleaseInput[];
```

with:

```typescript
  // Optional first release captured at job creation (qty + delivery date).
  // Further releases are added later from the job detail screen.
  first_release?: { planned_qty: number; planned_date: string } | null;
```

Leave the `ScheduledReleaseInput` interface in place (still referenced by the legacy `dispatch_schedules` types) — only the `AddJobFormData` field changes.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: errors ONLY in files that still reference the old shapes (`AddJobForm.tsx`, `print-runs` routes, `HistoryPanel.tsx`). These are fixed in later tasks. No errors inside `types.ts` itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): 6-stage PrintRun, planned fields, client stage log, first_release"
```

---

## Task 3: Release stage constants (single source of truth)

**Files:**
- Modify: `src/lib/constants/stages.ts`

- [ ] **Step 1: Append release-stage helpers**

At the end of `src/lib/constants/stages.ts`, add (note: imports `Department` to keep the dept map here, the one place stage knowledge lives):

```typescript
// ============================================================
// SCHEDULED-RELEASE RUN STAGES
// A release (print_run) moves through these 6 production stages.
// Prepress stages happen once on the job, never per release.
// This is the single source of truth for both the API and the UI.
// ============================================================
import type { Department } from './departments';

export const RELEASE_STAGE_ORDER = [
  'In Printing',
  'Slitting',
  'Quality Check',
  'Packing',
  'Ready to Dispatch',
  'Dispatched',
] as const;

export type ReleaseStage = typeof RELEASE_STAGE_ORDER[number];

// Which department may advance a release INTO each stage (Admin always allowed).
export const RELEASE_STAGE_DEPTS: Record<ReleaseStage, Department[]> = {
  'In Printing':       ['Production'],
  'Slitting':          ['Production'],
  'Quality Check':     ['QC'],
  'Packing':           ['Dispatch'],
  'Ready to Dispatch': ['Dispatch'],
  'Dispatched':        ['Dispatch'],
};

/** The next stage a release moves to, or null if already Dispatched. */
export function nextReleaseStage(current: ReleaseStage): ReleaseStage | null {
  const i = RELEASE_STAGE_ORDER.indexOf(current);
  if (i < 0 || i === RELEASE_STAGE_ORDER.length - 1) return null;
  return RELEASE_STAGE_ORDER[i + 1];
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no NEW errors originating in `stages.ts`. (Pre-existing errors from Task 2 in other files may remain.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/constants/stages.ts
git commit -m "feat(constants): release stage order + department map + nextReleaseStage()"
```

---

## Task 4: print-runs POST — accept planned qty/date + Admin add for scheduled jobs

**Files:**
- Modify: `src/app/api/jobs/[id]/print-runs/route.ts`

- [ ] **Step 1: Update the POST permission + body parsing**

In `src/app/api/jobs/[id]/print-runs/route.ts`, replace the permission check block and body parsing (the block from `// Print runs are created by Production…` through the `qtyThisRun`/`moreRuns` extraction) with:

```typescript
  // Releases for a scheduled job are added by Admin; legacy print runs
  // are created by Production. Allow both.
  if (dept !== 'Production' && dept !== 'Admin') {
    return NextResponse.json(
      { error: 'Only Production or Admin can create releases / print runs' },
      { status: 403 }
    );
  }

  const body: {
    qty_this_run?: number;
    planned_qty?:  number;
    planned_date?: string;
    more_runs?:    boolean;
    notes?:        string;
  } = await request.json();

  const qtyThisRun = body.qty_this_run;
  const moreRuns   = body.more_runs ?? false;

  if (!qtyThisRun || qtyThisRun <= 0) {
    return NextResponse.json(
      { error: 'qty_this_run must be a positive number' },
      { status: 400 }
    );
  }
```

- [ ] **Step 2: Persist planned fields and start at "In Printing"**

In the same file, in the `.insert({ … })` for `print_runs`, replace the object with:

```typescript
    .insert({
      job_id:              id,
      qty_this_run:        qtyThisRun,
      planned_qty:         body.planned_qty ?? qtyThisRun,
      planned_date:        body.planned_date || null,
      qty_remaining_after: remainingAfter,
      current_stage:       'In Printing',
      status:              'in_progress',
      notes:               body.notes?.trim() || null,
    })
```

And in the audit-log insert just below it, change the `stage` value from `'Printing'` to `'In Printing'`:

```typescript
  await admin
    .from('print_run_stage_logs')
    .insert({
      print_run_id: printRun.id,
      stage:        'In Printing',
      changed_by:   user.id,
      notes:        body.notes?.trim() || null,
    });
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors in `print-runs/route.ts`.

- [ ] **Step 4: Manual verification**

Start the dev server (`npm run dev`), log in as Admin, and POST a release via the browser devtools console on any open admin page (replace `<JOB_ID>` with a real scheduled job's id that has `label_qty` set):

```js
await fetch('/api/jobs/<JOB_ID>/print-runs', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ qty_this_run: 10000, planned_date: '2026-07-15', more_runs: true })
}).then(r => r.json())
```

Expected: `{ print_run: { run_number: 1, current_stage: 'In Printing', planned_date: '2026-07-15', ... } }`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/print-runs/route.ts
git commit -m "feat(api): releases carry planned qty/date and start at In Printing"
```

---

## Task 5: print-run stage advance — 6 stages + per-release dispatch notification

**Files:**
- Modify: `src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts`

- [ ] **Step 1: Replace the local stage order + dept map with the shared constants**

In `src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts`, replace the two local constants (`RUN_STAGE_ORDER` and `RUN_STAGE_DEPTS`) and the imports block at the top with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseDepartment } from '@/lib/constants/departments';
import { RELEASE_STAGE_ORDER, RELEASE_STAGE_DEPTS } from '@/lib/constants/stages';
import type { PrintRunStage } from '@/lib/types';

type Params = { params: Promise<{ id: string; runId: string }> };
```

Then delete the now-duplicate local `const RUN_STAGE_ORDER…` and `const RUN_STAGE_DEPTS…` declarations, and update every later reference: change `RUN_STAGE_ORDER` → `RELEASE_STAGE_ORDER` and `RUN_STAGE_DEPTS` → `RELEASE_STAGE_DEPTS`. (The validation, permission check, and sequential-progression logic stay byte-for-byte identical otherwise — they already index into the order array generically.)

- [ ] **Step 2: Add a per-release dispatch notification (best-effort)**

In the same file, find the `if (newStage === 'Dispatched') { … }` block that increments `total_qty_dispatched`. Immediately AFTER that block (before the audit-log insert), add:

```typescript
  // Per-release client notification on dispatch (best-effort — never blocks).
  if (newStage === 'Dispatched') {
    try {
      const origin = request.nextUrl.origin;
      await fetch(`${origin}/api/notifications/email`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          job_id:  id,
          trigger: 'release_dispatched',
          message: `Release #${run.run_number} dispatched — ${run.qty_this_run} labels.`,
        }),
      });
    } catch {
      // notification failure must not fail the stage update
    }
  }
```

> Note: `/api/notifications/email` already exists. If it does not accept a `trigger`/`message` shape, pass whatever payload that route already expects — read `src/app/api/notifications/email/route.ts` first and match its contract. The notification is best-effort and wrapped in try/catch, so a mismatch will not break the stage update.

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors in the stage route.

- [ ] **Step 4: Manual verification**

With the release created in Task 4, advance it one stage as Admin:

```js
await fetch('/api/jobs/<JOB_ID>/print-runs/<RUN_ID>/stage', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ new_stage: 'Slitting' })
}).then(r => r.json())
```

Expected: `{ print_run: { current_stage: 'Slitting', ... } }`. Advancing to a non-adjacent stage (e.g. `'Packing'`) must return a 409 with an "Invalid progression" error.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/[id]/print-runs/[runId]/stage/route.ts
git commit -m "feat(api): 6-stage release advance + per-release dispatch notification"
```

---

## Task 6: jobs POST — create the optional first release, drop dispatch_schedules write

**Files:**
- Modify: `src/app/api/jobs/route.ts`

- [ ] **Step 1: Replace the dispatch-schedules insert block**

In `src/app/api/jobs/route.ts`, replace the entire block beginning `// ── Insert dispatch schedule rows (if scheduled release) ──` (the `if (body.is_scheduled_release && body.scheduled_releases?.length) { … }` block) with:

```typescript
  // ── Create the optional first release (scheduled-release jobs) ──
  // Releases are print_runs. Further releases are added later from the
  // job detail screen. dispatch_schedules is no longer written for new jobs.
  if (body.is_scheduled_release && body.first_release && job.label_qty) {
    const qty = body.first_release.planned_qty;
    if (qty && qty > 0 && qty <= job.label_qty) {
      const remainingAfter = job.label_qty - qty;
      const { data: firstRun, error: runError } = await admin
        .from('print_runs')
        .insert({
          job_id:              job.id,
          qty_this_run:        qty,
          planned_qty:         qty,
          planned_date:        body.first_release.planned_date || null,
          qty_remaining_after: remainingAfter,
          current_stage:       'In Printing',
          status:              'in_progress',
        })
        .select()
        .single();

      if (runError) {
        console.error('[POST /api/jobs] insert first release:', runError);
      } else {
        await admin.from('jobs').update({ has_partial_runs: true }).eq('id', job.id);
        await admin.from('print_run_stage_logs').insert({
          print_run_id: firstRun.id,
          stage:        'In Printing',
          changed_by:   user.id,
        });
      }
    }
  }
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors in `api/jobs/route.ts`. (`AddJobForm.tsx` may still error — fixed in Task 7.)

- [ ] **Step 3: Manual verification**

After Task 7 wires the form, this is verified end-to-end there. For now confirm the route compiles and the build passes:

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat(api): create optional first release on job create; stop writing dispatch_schedules"
```

---

## Task 7: Add-Job form — single optional first release

**Files:**
- Modify: `src/components/admin/AddJobForm.tsx`

- [ ] **Step 1: Replace the releases state with first-release state**

In `src/components/admin/AddJobForm.tsx`:

Remove the `releases` state and its helpers (`addRelease`, `removeRelease`, `updateRelease`) and the `ScheduledReleaseInput` import. Replace the `releases` `useState` (around line 55) with:

```typescript
  const [firstReleaseQty,  setFirstReleaseQty]  = useState<number | ''>('');
  const [firstReleaseDate, setFirstReleaseDate] = useState<string>('');
```

Update the `EMPTY_FORM` object: remove `scheduled_releases: []` and add `first_release: null`.

- [ ] **Step 2: Update the submit payload**

Replace the `payload` construction inside `handleSubmit` with:

```typescript
    const payload: AddJobFormData = {
      ...form,
      first_release:
        form.is_scheduled_release && firstReleaseQty && firstReleaseDate
          ? { planned_qty: Number(firstReleaseQty), planned_date: firstReleaseDate }
          : null,
    };
```

And in the success branch, replace the `setReleases([...])` reset line with:

```typescript
      setFirstReleaseQty('');
      setFirstReleaseDate('');
```

- [ ] **Step 3: Replace the releases UI block**

Replace the entire `{form.is_scheduled_release && ( … )}` block (the `releases.map(...)` + "Add release" button) with:

```tsx
          {form.is_scheduled_release && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--glass-muted)]">
                Optionally enter the first release now. You can add more releases
                later from the job&rsquo;s detail screen as the client confirms them.
              </p>
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-1 text-center">
                  <span className="text-xs text-[var(--glass-muted)] font-mono">R1</span>
                </div>
                <div className="col-span-5">
                  <input
                    type="number"
                    min={1}
                    value={firstReleaseQty}
                    onChange={(e) => setFirstReleaseQty(e.target.value ? Number(e.target.value) : '')}
                    placeholder="First release qty"
                    className={cn(inputCls, 'font-mono text-xs')}
                  />
                </div>
                <div className="col-span-6">
                  <input
                    type="date"
                    value={firstReleaseDate}
                    onChange={(e) => setFirstReleaseDate(e.target.value)}
                    className={cn(inputCls, 'text-xs')}
                  />
                </div>
              </div>
            </div>
          )}
```

- [ ] **Step 4: Type-check + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Manual verification**

`npm run dev`, log in as Admin, click Add Job. Tick "Scheduled Release Order" → confirm a single optional R1 qty+date row appears (no "+ Add release"). Submit with PO + Party + Label Qty + R1 (qty 10000, a date). Open the new job in the DB (`select * from print_runs where job_id=…`) → expect one row, `current_stage='In Printing'`, `planned_date` set.

- [ ] **Step 6: Commit**

```bash
git add src/components/admin/AddJobForm.tsx
git commit -m "feat(admin): Add-Job captures a single optional first release"
```

---

## Task 8: Admin job detail — "Releases" section (add / advance / block when delivered)

**Files:**
- Modify: `src/components/admin/HistoryPanel.tsx`
- Create: `src/components/admin/modals/AddReleaseModal.tsx` (added via `modals/index.tsx`)

- [ ] **Step 1: Create the AddReleaseModal**

Create `src/components/admin/modals/AddReleaseModal.tsx`:

```tsx
'use client';
// src/components/admin/modals/AddReleaseModal.tsx

import { useState } from 'react';
import { cn, formatQty } from '@/lib/utils';

type Props = {
  remaining: number;                 // qty still undelivered for this job
  releaseNumber: number;             // the next release number (display only)
  onCancel: () => void;
  onConfirm: (payload: { qty_this_run: number; planned_date: string; more_runs: boolean }) => void;
};

export default function AddReleaseModal({ remaining, releaseNumber, onCancel, onConfirm }: Props) {
  const [qty,  setQty]  = useState<number | ''>('');
  const [date, setDate] = useState<string>('');

  const qtyNum    = typeof qty === 'number' ? qty : 0;
  const invalid   = qtyNum <= 0 || qtyNum > remaining || !date;
  const moreRuns  = qtyNum < remaining; // false => this release closes out the order

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="glass rounded-2xl p-6 w-full max-w-sm space-y-4">
        <h3 className="text-base font-semibold text-[var(--glass-ink)]">
          Add Release {releaseNumber}
        </h3>
        <p className="text-xs text-[var(--glass-muted)]">
          {formatQty(remaining)} labels remaining to deliver.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--glass-muted)] mb-1 uppercase tracking-wide">
              Release Qty
            </label>
            <input
              type="number"
              min={1}
              max={remaining}
              value={qty}
              onChange={(e) => setQty(e.target.value ? Number(e.target.value) : '')}
              placeholder={`max ${remaining}`}
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)] font-mono"
            />
            {qtyNum > remaining && (
              <p className="text-xs text-[#B23B2E] mt-1">Exceeds remaining quantity.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--glass-muted)] mb-1 uppercase tracking-wide">
              Delivery Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-[var(--glass-muted)] hover:text-[var(--glass-ink)]"
          >
            Cancel
          </button>
          <button
            disabled={invalid}
            onClick={() => onConfirm({ qty_this_run: qtyNum, planned_date: date, more_runs: moreRuns })}
            className={cn(
              'px-5 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white',
              'hover:bg-brand-primary/90 disabled:opacity-40'
            )}
          >
            Add Release
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export it from the modals barrel**

In `src/components/admin/modals/index.tsx`, add an export line alongside the existing modal exports:

```typescript
export { default as AddReleaseModal } from './AddReleaseModal';
```

(If `modals/index.tsx` re-declares modals inline rather than re-exporting files, instead add `export { default as AddReleaseModal } from './AddReleaseModal';` at the top of the file — confirm the existing pattern first by reading the file.)

- [ ] **Step 3: Rewire `PrintRunsSection` in HistoryPanel to the release model**

In `src/components/admin/HistoryPanel.tsx`:

Replace the imports of `PrintRunModal` and the local `NEXT_RUN_STAGE` / `RUN_STAGE_DEPTS` constants with the shared ones. Update the top import block to include:

```typescript
import { AddReleaseModal } from './modals';
import { RELEASE_STAGE_DEPTS, nextReleaseStage } from '@/lib/constants/stages';
import type { ReleaseStage } from '@/lib/constants/stages';
```

Delete the local `const NEXT_RUN_STAGE…` and `const RUN_STAGE_DEPTS…` blocks.

In `PrintRunsSection`, replace the early return and the derived gating values with logic driven by `is_scheduled_release` and the "fully delivered" rule:

```typescript
  if (!loaded) return null;

  const totalQty      = job.label_qty ?? 0;
  const dispatchedQty = job.total_qty_dispatched ?? 0;
  const remainingQty  = totalQty - dispatchedQty;
  const anyInProgress = runs.some((r) => r.status === 'in_progress');
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
```

> Note: `job` here is a `JobDetail`; ensure `is_scheduled_release` is present on it (it extends `Job`, which already has the field — no change needed).

- [ ] **Step 4: Use the shared next-stage helper for the advance button**

Inside `PrintRunsSection`, in the `advanceRun` function, replace `const nextStage = NEXT_RUN_STAGE[run.current_stage];` with:

```typescript
    const nextStage = nextReleaseStage(run.current_stage as ReleaseStage);
```

And in the `runs.map(...)` render, replace `const nextStage = NEXT_RUN_STAGE[run.current_stage];` and the `mayAdvance` calc with:

```typescript
          const nextStage  = nextReleaseStage(run.current_stage as ReleaseStage);
          const mayAdvance =
            !isDone && nextStage !== null &&
            (dept === 'Admin' || RELEASE_STAGE_DEPTS[nextStage].includes(dept));
```

And in the `🔒` lock label, replace `RUN_STAGE_DEPTS[nextStage].join('/')` with `RELEASE_STAGE_DEPTS[nextStage].join('/')`.

- [ ] **Step 5: Replace the "Start Next Print Run" UI with "Add Release" + delivered banner**

Replace the entire `{awaitingNext && ( … )}` block AND the `{showModal && ( <PrintRunModal … /> )}` block at the bottom of `PrintRunsSection` with:

```tsx
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
```

- [ ] **Step 6: Add the `addRelease` handler**

In `PrintRunsSection`, rename/replace the existing `startNextRun` function with `addRelease` that posts the planned fields:

```typescript
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
```

- [ ] **Step 7: Rename the section heading**

In `PrintRunsSection`'s returned JSX, change the heading text from `Print Runs` to `Releases`, and in the run card change `Run #{run.run_number}` to `Release {run.run_number}` and add the planned date under the qty:

```tsx
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
```

- [ ] **Step 8: Type-check + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass. If `PrintRunModal` is now unused and flagged by lint, remove its import.

- [ ] **Step 9: Manual verification**

`npm run dev`, Admin, open a scheduled job's detail page:
- Confirm the section is titled "Releases" and shows the first release with its delivery date.
- Advance the active release stage-by-stage (as Admin) to Dispatched.
- After dispatch, an "+ Add Release" button appears; click it, add Release 2 (qty + date) → it appears as In Printing.
- Add releases until remaining = 0; confirm "+ Add Release" disappears and the green "All N labels delivered across N releases" banner shows.
- While a release is in progress, confirm "+ Add Release" is hidden and the "finish… before adding the next" hint shows.

- [ ] **Step 10: Commit**

```bash
git add src/components/admin/HistoryPanel.tsx src/components/admin/modals/AddReleaseModal.tsx src/components/admin/modals/index.tsx
git commit -m "feat(admin): Releases section with add/advance and delivered guard"
```

---

## Task 9: Client portal data — fetch client-safe stage logs for scheduled jobs

**Files:**
- Modify: `src/app/track/[po]/page.tsx`

- [ ] **Step 1: Fetch the stage-log view and add it to each bundle**

In `src/app/track/[po]/page.tsx`:

Add `ClientPrintRunStageLog` to the type import from `@/lib/types`.

In the `Promise.all([...])` inside the `jobs.map`, add a fifth fetch after `printRunsRes`:

```typescript
        job.is_scheduled_release
          ? anonClient
              .from('client_print_run_stage_log_view')
              .select('*')
              .order('changed_at', { ascending: true })
          : Promise.resolve({ data: [] }),
```

Update the destructuring to include it:

```typescript
      const [logsRes, timestampsRes, schedulesRes, printRunsRes, runLogsRes] = await Promise.all([
```

> Note: the view has no `job_id` column, so it is filtered by `print_run_id` on the client. Each bundle keeps only the logs whose `print_run_id` belongs to this job's runs:

```typescript
      const runIds = new Set((printRunsRes.data ?? []).map((r: PrintRun) => r.id));
      const runLogs = ((runLogsRes.data ?? []) as ClientPrintRunStageLog[])
        .filter((l) => runIds.has(l.print_run_id));
```

Add `runLogs` to the returned bundle object, and add `runLogs: ClientPrintRunStageLog[];` to the bundle's `as Array<{…}>` cast.

- [ ] **Step 2: Type-check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: pass. (`TrackJobAccordion` may error about the new bundle field until Task 10 — acceptable mid-task; if blocking the build, proceed to Task 10 and verify both together.)

- [ ] **Step 3: Commit**

```bash
git add src/app/track/[po]/page.tsx
git commit -m "feat(track): fetch client-safe per-step release logs for scheduled jobs"
```

---

## Task 10: Client portal — side-by-side release columns

**Files:**
- Create: `src/components/track/ReleaseColumns.tsx`
- Modify: `src/components/track/TrackJobAccordion.tsx`
- Modify: `src/components/track/StagePipeline.tsx`

- [ ] **Step 1: Create ReleaseColumns**

Create `src/components/track/ReleaseColumns.tsx`:

```tsx
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
```

- [ ] **Step 2: Wire ReleaseColumns into TrackJobAccordion**

In `src/components/track/TrackJobAccordion.tsx`:

Add the imports:

```typescript
import ReleaseColumns from './ReleaseColumns';
import type { ClientPrintRunStageLog } from '@/lib/types';
```

Add `runLogs: ClientPrintRunStageLog[];` to the `TrackJobBundle` type.

In BOTH render paths (the multi-job `ExpandPanel` body and `SingleJobDetail`), replace the existing scheduled-release block:

```tsx
                  {bundle.job.is_scheduled_release && bundle.schedules.length > 0 && (
                    <Reveal onScroll>
                      <ScheduledReleaseCard schedules={bundle.schedules} />
                    </Reveal>
                  )}
```

with:

```tsx
                  {bundle.job.is_scheduled_release && bundle.printRuns.length > 0 ? (
                    <Reveal onScroll>
                      <ReleaseColumns
                        runs={bundle.printRuns}
                        runLogs={bundle.runLogs}
                        totalQty={bundle.job.label_qty}
                        totalDispatched={bundle.job.total_qty_dispatched ?? 0}
                      />
                    </Reveal>
                  ) : bundle.job.is_scheduled_release && bundle.schedules.length > 0 ? (
                    <Reveal onScroll>
                      <ScheduledReleaseCard schedules={bundle.schedules} />
                    </Reveal>
                  ) : null}
```

(Apply the same replacement in `SingleJobDetail`, adjusting indentation. `ScheduledReleaseCard` stays imported as the legacy fallback for any old job that still has `dispatch_schedules` rows.)

- [ ] **Step 3: Hide the StagePipeline print-run block for scheduled jobs**

In `src/components/track/StagePipeline.tsx`:

Add `is_scheduled_release?: boolean;` to the `job` shape in `Props`.

Change the print-runs block guard from:

```tsx
      {job.has_partial_runs && printRuns.length > 0 && (
```

to:

```tsx
      {!job.is_scheduled_release && job.has_partial_runs && printRuns.length > 0 && (
```

This keeps the legacy inline "Production Cycles" list for non-scheduled multi-run jobs, while scheduled jobs use the new `ReleaseColumns` instead (avoiding double display). `StagePipeline` already receives the full `job` object from `TrackJobAccordion`, so `is_scheduled_release` flows through automatically.

- [ ] **Step 4: Type-check + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 5: Manual verification**

`npm run dev`. Create/advance a scheduled job with 2–3 releases at different stages (use the admin Releases UI from Task 8). Open `/track/<PO>`:
- Confirm a "Releases" card shows N columns side-by-side, horizontally scrollable on a narrow window.
- The latest release is open by default; clicking a column header expands/collapses it.
- Each expanded column lists the 6 stages; completed stages show a green dot + timestamp, the active stage pulses, future stages are muted.
- The shared prepress stages still appear once in the "Order Progress" pipeline above (not duplicated per column).
- The summary line shows delivered/total/remaining correctly.

- [ ] **Step 6: Commit**

```bash
git add src/components/track/ReleaseColumns.tsx src/components/track/TrackJobAccordion.tsx src/components/track/StagePipeline.tsx
git commit -m "feat(track): side-by-side release columns with per-step timestamps"
```

---

## Task 11: Full-flow verification & cleanup

**Files:** none (verification only)

- [ ] **Step 1: End-to-end walkthrough**

With `npm run dev` running, perform the full lifecycle and confirm each:

1. Admin → Add Job, tick Scheduled Release, label_qty 100000, first release 15000 + date → job created with Release 1 (In Printing).
2. Advance Release 1 through all 6 stages to Dispatched (switch the acting department per stage, or use Admin for all).
3. "+ Add Release" appears → add Release 2 (10000 + date); advance to Dispatched.
4. Repeat until total dispatched = 100000 → confirm "+ Add Release" disappears and the green "all delivered" banner shows; attempting another release via API returns a 400 (qty exceeds remaining).
5. Client portal `/track/<PO>` shows N release columns, each with correct per-step timestamps, prepress shown once.

- [ ] **Step 2: Confirm no regressions on a normal (non-scheduled) job**

Create a normal job (checkbox unticked), move it through the main pipeline including a classic Partial Dispatch, and confirm the admin detail + client portal behave exactly as before (no Releases card, no errors).

- [ ] **Step 3: Final gate**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass with no errors.

- [ ] **Step 4: Commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore: scheduled-release flow end-to-end verification cleanup"
```

---

## Self-Review

**Spec coverage:**
- Checkbox marks job scheduled → Task 7. ✓
- Add releases over time (qty + delivery date) → Tasks 4, 8. ✓
- Each release runs the full production pipeline; prepress once → Tasks 3, 5 (6-stage advance); prepress stays on the job (unchanged). ✓
- Optional first release at creation → Tasks 6, 7. ✓
- Sequential (one release in progress at a time) → enforced by existing API "active run" check (Task 4 keeps it) + admin guard (Task 8). ✓
- Block adding releases once fully delivered, with "all delivered" message → Task 8 (`fullyDelivered`, banner) + API qty guard. ✓
- Client side-by-side columns, click → per-step timestamps, prepress shared once → Tasks 1 (view), 9 (fetch), 10 (columns + StagePipeline guard). ✓
- Per-release dispatch notification → Task 5. ✓
- Server-side qty math, can't exceed label_qty → existing API + Tasks 4/6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one conditional instruction (notifications payload shape in Task 5) is explicitly bounded and best-effort.

**Type consistency:** `PrintRunStage`/`ReleaseStage` both use the 6-value vocabulary; `RELEASE_STAGE_ORDER`, `RELEASE_STAGE_DEPTS`, `nextReleaseStage` are defined in Task 3 and consumed in Tasks 5, 8, 10; `ClientPrintRunStageLog` defined in Task 2, consumed in Tasks 9, 10; `first_release` defined in Task 2, produced in Task 7, consumed in Task 6; `AddReleaseModal` props (`qty_this_run`/`planned_date`/`more_runs`) match the print-runs POST body from Task 4.
