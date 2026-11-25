// src/lib/api/dispatchedPerLine.ts
import { createAdminClient } from '@/lib/supabase/admin';
import { allPages } from '@/lib/api/allPages';
import { dispatchedByLine } from '@/lib/dispatchLedger';

// Dispatched labels per line: the counted dispatch entries (confirmed, not
// removed) matched by their link or PO + PM code, the same way Reports matches
// them (lib/dispatchLedger.ts). Matched against every live line, so a PO + PM
// code shared by two lines stays unmatched instead of guessed.
// ponytail: reads the live lines' keys and every counted entry per request
// (~500 lines and a few hundred entries a month); cache or filter by PO
// past ~20k lines.
export async function dispatchedPerLine(): Promise<Map<string, number>> {
  const admin = createAdminClient();
  const [lines, entries] = await Promise.all([
    allPages<{ id: string; po_no: string | null; pm_code: string | null }>((from, to) => admin.from('job_separations')
      .select('id, po_no, pm_code').is('cancelled_at', null).order('id').range(from, to)),
    allPages<{ po_number: string; pm_code: string | null; qty: number | null; line_id: string | null }>((from, to) => admin.from('pending_dispatch_notifications')
      .select('po_number, pm_code, qty, line_id').not('confirmed_at', 'is', null).is('removed_at', null).order('id').range(from, to)),
  ]);
  return dispatchedByLine(lines, entries);
}
