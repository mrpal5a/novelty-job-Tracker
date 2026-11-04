// src/lib/dispatchChecks.ts
// Server side of the dispatch entry checks: fetch the order lines and the
// live entries for one PO, then let lib/dispatchLedger.ts say what's wrong.
// Used by POST /api/dispatch-notifications, PATCH …/[id], PUT …/[id]/line and
// the Job Separation dispatch route. Warnings never block: the route answers
// 409 with them and saves when sent back with confirm: true.

import type { SupabaseClient } from '@supabase/supabase-js';
import { containsPattern } from './search';
import { pmKey } from './reports';
import { entryWarnings, lineFor, lineMatcher, poKey } from './dispatchLedger';

const LINE = 'id, sr_no, po_no, pm_code, material_name, quantity';
const ENTRY = 'id, po_number, pm_code, qty, created_at, line_id';

type Line = { id: string; sr_no: string | null; po_no: string | null; pm_code: string | null; material_name: string | null; quantity: number | null };
type Entry = { id: string; po_number: string; pm_code: string | null; qty: number | null; created_at: string; line_id: string | null };

/** A line this PO and PM code could mean; the form asks which when there's more than one. */
export type LineChoice = Line;

// A linked entry's PO can differ from its line's, so it's read by link too.
async function liveEntries(admin: SupabaseClient, pattern: string, lineId: string | null): Promise<Entry[]> {
  const [byPo, byLink] = await Promise.all([
    admin.from('pending_dispatch_notifications').select(ENTRY).is('removed_at', null).ilike('po_number', pattern),
    lineId
      ? admin.from('pending_dispatch_notifications').select(ENTRY).is('removed_at', null).eq('line_id', lineId)
      : Promise.resolve({ data: [] as Entry[], error: null }),
  ]);
  if (byPo.error) throw new Error(byPo.error.message);
  if (byLink.error) throw new Error(byLink.error.message);
  return Array.from(new Map([...(byPo.data as Entry[]), ...(byLink.data as Entry[])].map((x) => [x.id, x])).values());
}

/**
 * `lineId`: the line the entry is tied to, if someone picked it. `line` comes
 * back null when that line is gone or cancelled, so callers can refuse it.
 */
export async function dispatchCheck(
  admin: SupabaseClient,
  e: { po: string; pm: string | null; qty: number | null; excludeId?: string; lineId?: string | null },
): Promise<{ warnings: string[]; choices: LineChoice[]; line: Line | null }> {
  // ilike %po% finds the PO however it was spaced or cased; lineFor then
  // keeps the exact ones.
  const pattern = containsPattern(e.po.trim());
  const { data, error } = await admin.from('job_separations').select(LINE).is('cancelled_at', null).ilike('po_no', pattern);
  if (error) throw new Error(error.message);
  const lines = data as Line[];

  let pinned: Line | null = null;
  if (e.lineId) {
    const found = await admin.from('job_separations').select(LINE).is('cancelled_at', null).eq('id', e.lineId).maybeSingle();
    if (found.error) throw new Error(found.error.message);
    pinned = found.data as Line | null;
    if (pinned && !lines.some((l) => l.id === pinned!.id)) lines.push(pinned);
  }

  const line = e.lineId ? pinned : lineFor(e.po, e.pm, lines);
  const code = pmKey(e.pm);
  const choices = line ? [] : lines.filter((l) => poKey(l.po_no) === poKey(e.po) && (!code || pmKey(l.pm_code) === code));

  const match = lineMatcher(lines);
  const samePoPm = (x: Entry) => poKey(x.po_number) === poKey(e.po) && pmKey(x.pm_code) === code;
  const entries = await liveEntries(admin, pattern, line?.id ?? null);
  const others = entries.filter((x) => x.id !== e.excludeId && (line
    // An unlinked entry on the same PO + PM code may well be for this line: still worth flagging.
    ? match(x.po_number, x.pm_code, x.line_id)?.id === line.id || (!x.line_id && samePoPm(x) && !match(x.po_number, x.pm_code))
    : samePoPm(x)));

  return { warnings: entryWarnings({ line, others, qty: e.qty, now: new Date(), choices: choices.length }), choices, line };
}

/** Labels already entered against one line, leaving out the entry being linked. */
export async function enteredOnLine(
  admin: SupabaseClient,
  line: { id: string; po_no: string | null },
  excludeId: string,
): Promise<number> {
  const po = line.po_no?.trim();
  const pattern = containsPattern(po || line.id);   // no PO: nothing matches it, only links reach this line
  const [lines, entries] = await Promise.all([
    admin.from('job_separations').select('id, po_no, pm_code').is('cancelled_at', null).ilike('po_no', pattern),
    liveEntries(admin, pattern, line.id),
  ]);
  if (lines.error) throw new Error(lines.error.message);
  const match = lineMatcher(po ? lines.data : [{ id: line.id, po_no: null, pm_code: null }]);
  return entries
    .filter((x) => x.id !== excludeId && match(x.po_number, x.pm_code, x.line_id)?.id === line.id)
    .reduce((s, x) => s + (x.qty ?? 0), 0);
}
