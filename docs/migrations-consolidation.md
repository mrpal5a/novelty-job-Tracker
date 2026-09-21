# Migration consolidation (Sept 2026)

The original `supabase/migrations/` history was 58 files (`001_initial_schema.sql`
through `058_bom_costing.sql`), accumulated incrementally as features shipped and
occasionally patched (a stage-vocabulary bug fixed twice, a trigger fixed a
migration later, a whole feature built and then torn out). That history is useful
as a historical record but was never applied to any database — this project's
Supabase instance was created empty — so it was replaced with **16 files** that
build the exact same **final schema** directly, skipping every step that a later
migration immediately undid.

If you need the original step-by-step history (e.g. to understand *why* something
is shaped the way it is, or to recover a decision), it's preserved in git history —
`git log --diff-filter=D -- supabase/migrations` or simply check out a commit
before this consolidation.

## What got dropped entirely (confirmed dead — never reached the app)

| Table(s) | Created by | Reversed by | Why safe to omit |
|---|---|---|---|
| `bom_requests`, `bom_request_items` | 031 | 058 | Replaced by the costing model (`bom_costings`/`bom_material_requests`). No app code references these tables (verified by grep before consolidating). |
| `meter_calculator_access` | 048 | 050 | Per-user grants reversed in favor of the department-permission system (`meter_calculator_use` feature key). |
| `box_slips`, `roll_slips` | 052, 053 | 054 | Feature moved entirely client-side (`SlipsManager.tsx`); no server round-trip left. Only the `box_slip_print`/`roll_slip_print` permission rows survive (still gate the print buttons). |

## What got collapsed (fixed-in-place, only the final version kept)

| Area | Original migrations | New file |
|---|---|---|
| `print_runs` stage vocabulary | 003 → 005 (bug fix) → 006 (bug fix) → 007 (extended) → 008 | `005_print_runs.sql` |
| `job_separations` Sr. No. trigger | 022 → 051 (replaced wholesale) | `009_job_separations_and_parties.sql` |
| `shade_card_status_history` trigger | 055 → 056 (SECURITY DEFINER fix) | `015_shade_cards.sql` |
| `job_status_logs.changed_by_dept` CHECK | 001 → 015 (widened) → 039 (loosened to data-driven) | `004_jobs_core.sql` |
| `client_job_view` / `client_status_log_view` | 001 → 004 → 006 → 039 (redefined each time) | `004_jobs_core.sql` |
| `flatbed_dies` status tracking | 035 (added) → 036 (dropped for a serial number) | `008_dies_and_plates.sql` |
| ~10 near-identical `trigger_touch_<table>()` functions | 013, 019, 020, 022, 027 (×2), 032, 035, 058 (×2) | one shared `trigger_set_updated_at()` in `001_extensions_and_helpers.sql`, reused by every table's `updated_at` trigger |

## File mapping

| New file | Replaces (original numbers) |
|---|---|
| `001_extensions_and_helpers.sql` | pieces of 001, 013, 019, 020, 022, 027, 032, 035, 058 |
| `002_departments_and_permissions.sql` | 039, 040, 041, 050, 052, 053, 055 (seed rows only) |
| `003_printing_units.sql` | 012 (table half) |
| `004_jobs_core.sql` | 001, 003 (columns), 004, 006, 011, 012 (columns), 015, 016, 018, 039 (views/check) |
| `005_print_runs.sql` | 003, 005, 006, 007, 008 |
| `006_machines.sql` | 009, 010 |
| `007_label_stock.sql` | 013 |
| `008_dies_and_plates.sql` | 019, 020, 021, 035, 036, 049 |
| `009_job_separations_and_parties.sql` | 022, 023, 025, 033, 034, 051 |
| `010_prepress_todos.sql` | 024, 026, 028, 029, 030 |
| `011_register_crm.sql` | 027, 040 (RLS) |
| `012_party_contacts.sql` | 002, 040 (RLS), 046 |
| `013_dispatch_notifications.sql` | 037, 038, 040 (RLS), 042, 043, 044, 045 |
| `014_bill_of_materials.sql` | 032 (final shape), 058 |
| `015_shade_cards.sql` | 055, 056 |
| `016_note_reads.sql` | 017 |

## One intentional preserved inconsistency

`pending_dispatch_notifications` RLS: `SELECT`/`UPDATE` use
`dept_has_permission('dispatch_notifications')` (rewritten by migration 040), but
`INSERT`/`DELETE` use `current_dept() IN ('Dispatch', 'Admin')` directly — those two
policies were added by migrations 042/043, both *after* 040, and were never
migrated onto the permission-table system. This is genuinely how the app behaves
today. It's called out in a comment in `013_dispatch_notifications.sql` rather than
"fixed," since the brief was zero behavior change.

## Functionality check

Every table, column, index, trigger, function, RLS policy, and seed row that the
application code (`src/`) actually reads or writes is preserved. Confirmed via:
- Full read of all 58 original migrations, table by table, function by function.
- `grep -rl` across `src/` for each table being considered for removal — zero
  hits for `bom_requests`, `bom_request_items`, `box_slips`, `roll_slips`,
  `meter_calculator_access`.
- Cross-file dependency check (no `CREATE TABLE` reads with a forward `REFERENCES`
  to a table defined in a later file; no duplicate index/trigger/table names).
