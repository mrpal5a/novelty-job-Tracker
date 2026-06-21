# Scheduled-Release Multi-Cycle Orders — Design

**Date:** 2026-06-22
**Status:** Approved (design); pending implementation plan
**Author:** Brainstormed with Claude

---

## Problem

For large single-product orders, the client commits a total quantity but **not** a
firm delivery schedule. Example: a 100,000-label order for Product A. The client
confirms 15,000 for a known date; the remaining 85,000 will be dispatched later —
in an unknown number of releases (could be 2, could be 7), at unknown times (next
15 days or next 60). Production only prints what's currently due; the rest stays
pending.

The team needs to:

1. Mark such a job as a **scheduled-release** order at creation time.
2. **Add releases over time** as the client notifies them (release #, qty,
   delivery date) — these are not known up front.
3. Run **each release through its own full production cycle** (printing →
   dispatch), while **prepress runs only once** for the whole job.
4. **Stop adding releases** once the full ordered quantity has been delivered,
   showing an "all delivered" state.
5. Let the client see, on the tracking portal, **one column per release**
   side-by-side, each expandable to show every step and its timestamp. Prepress
   timestamps are shared (shown once) across all releases.

## Current state (what already exists)

The codebase already contains most of the machinery, split across two
**disconnected** systems:

- **Planning — `dispatch_schedules`** (migration 001): the "Scheduled Release
  Order" checkbox in `AddJobForm` makes the user enter *all* releases up front
  (release #, planned qty, planned date). These are plan-only rows with no
  production steps. Read by the client portal when `is_scheduled_release` is true.
- **Execution — `print_runs` + `print_run_stage_logs`** (migrations 003/004): a
  complete backend where each "run" moves through `Printing → QC → Packing →
  Dispatched` independently, with append-only per-stage audit logs, server-side
  quantity math, and a "one run in progress at a time" rule. Created manually by
  Production, tracked via `jobs.has_partial_runs`. It has **no admin UI** and is
  **not** linked to the checkbox or to delivery dates.

The shared pre-production stages already exist in the 15-stage pipeline
(`src/lib/constants/stages.ts`), and `getVisibleStages()` / the `In Printing`
prerequisite already encode the New-vs-Repeat difference.

## Decision

**Unify onto the `print_runs` system.** Each "Release" is one `print_run` row.
This reuses the working create/advance/audit backend, the sequential rule, and —
critically — `print_run_stage_logs` already provides exactly the per-step
timestamps the client columns need. The up-front `dispatch_schedules` entry is
retired for scheduled jobs; planned qty + date move onto the release itself.

Alternatives rejected:

- **Release-as-job-clone** (reuse the full 15-stage status pipeline per release):
  more uniform with existing job mechanics but requires heavy new tables and
  duplicated status/modal logic.
- **Keep both tables, link 1:1**: preserves the redundancy that already causes
  confusion.

### Confirmed choices

1. **Per-release steps = full production stages**, matching normal jobs:
   `In Printing → Slitting → Quality Check → Packing → Ready to Dispatch →
   Dispatched`. The client sees identical stage names everywhere.
2. **Sequential**: a release must reach `Dispatched` before the next release can
   start production (matches the existing one-in-progress rule).
3. **Optional first release at Add-Job**: the checkbox plus one optional
   first-release (qty + date). Further releases are added later from the job's
   edit screen.
4. Main status dropdown **locks at the pre-production gate** for scheduled jobs.
5. **Add Release is Admin-only.**

---

## Design

### 1. Data model changes

- **`print_runs`** gains:
  - `planned_qty INTEGER` — the qty the client notified for this release.
  - `planned_date DATE` — this release's delivery date.
  - `current_stage` enum expands from 4 values to the 6 production stages:
    `In Printing, Slitting, Quality Check, Packing, Ready to Dispatch,
    Dispatched`. `qty_this_run` remains the actual dispatched qty.
- Per-step timestamps continue to come from **`print_run_stage_logs`** (one row
  per stage change) — no new table.
- **Shared "once" stages** = every stage *before* `In Printing`:
  - New jobs: PO Received, Artwork Received, Prepress/Design Check, Sample
    Printing, Shade Card Sent, Shade Card Approved.
  - Repeat jobs: PO Received, Artwork Received, Prepress/Design Check.
  These live on the job as today and render once, identically across all release
  columns.
- A scheduled-release job is identified by `is_scheduled_release = true`. The
  release flow (formerly gated on `has_partial_runs`) applies to these jobs.

### 2. Add-Job

Keep the "Scheduled Release Order" checkbox. When ticked, replace the current
multi-row entry with **one optional "first release"** (qty + delivery date):

- If filled → the first `print_run` (planned) is created with the job.
- If left empty → only `is_scheduled_release` is set; all releases added later.

### 3. Admin — job detail (`JobDetailClient`)

For a scheduled-release job:

- The main status dropdown drives **only the shared pre-production stages**,
  locked at the gate before `In Printing`.
- A new **Releases** section: one card per release showing its 6-stage progress +
  timestamps, with stage-advance controls gated by department exactly like the
  main pipeline:
  - Production → In Printing, Slitting
  - QC → Quality Check
  - Dispatch → Packing, Ready to Dispatch, Dispatched
  - Admin → any
- An **"Add Release"** button (Admin only) opens a small form: qty + delivery
  date. It is **blocked** when `Σ delivered = label_qty`, showing
  *"All N,NNN labels delivered across N releases."* The sequential rule blocks
  adding/starting a new release while one is still in progress.

### 4. Client portal — tracking (`track/[po]`, `TrackJobAccordion`)

For a scheduled-release job:

- Render the shared pre-production stages once.
- Then render **N side-by-side release columns** (Release 1 … Release N). Each
  column header shows qty + current status; expanding a release shows every step
  with its timestamp.
- Prepress timestamps are identical across columns — shown once, above the
  columns.
- Responsive: columns on desktop; stacked / horizontally swipeable on mobile.

### 5. Notifications & edge cases

- Each release reaching **Dispatched** fires the existing client notification,
  e.g. *"Release 2 dispatched — 10,000 labels."*
- All quantity math is server-side; the sum of release quantities can never
  exceed `label_qty`.
- When all quantity is delivered, the job is treated as complete and "Add
  Release" is disabled with the "all delivered" message.

---

## Out of scope

- Editing/deleting a release after it has started production (releases are
  append-only, like the existing audit trail). Admin delete may be considered
  later if needed.
- Concurrent / overlapping releases (explicitly chose sequential).
- Changing the classic (non-scheduled) job flow or the existing `print_runs`
  manual flow for any job that doesn't use `is_scheduled_release`.
