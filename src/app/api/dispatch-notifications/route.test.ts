// POST /api/dispatch-notifications and PATCH /api/dispatch-notifications/[id] —
// a dispatch entry typed in by hand. Its qty is what Reports and the Job
// Separation worksheet add up, so a bad number here is a wrong total there.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, params, writes } from '@/test/api';
import { POST } from './route';
import { PATCH } from './[id]/route';

const ENTRIES = 'pending_dispatch_notifications';
const ENTRY = { party: 'Acme', po_number: 'PO-1', pm_code: 'PM-1', job_name: 'Label', status: 'Dispatched', qty: 500 };
const LINE  = { id: 'line-1', sr_no: 'NOV26-1', po_no: 'PO-1', pm_code: 'PM-1', material_name: 'Label', quantity: 1_000 };

/** The order book holds one matching line, and nothing has been entered against it. */
function orderBook(lines: unknown[] = [LINE]) {
  respond((c) => {
    if (c.table === 'job_separations') return { data: lines };
    if (c.table === ENTRIES && c.op === 'select') return { data: [] };
  });
}

const add  = (body: unknown) => POST(json('/api/dispatch-notifications', 'POST', body));
const edit = (body: unknown) => PATCH(json('/api/dispatch-notifications/e1', 'PATCH', body), params({ id: 'e1' }));

describe('POST /api/dispatch-notifications', () => {
  it('401 signed out, 403 for another department', async () => {
    expect((await add(ENTRY)).status).toBe(401);
    signIn('QC');
    expect((await add(ENTRY)).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('saves an entry that matches an order line', async () => {
    signIn('Dispatch'); orderBook();
    const res = await add(ENTRY);
    expect(await res.json()).toEqual({ added: true });
    expect(writes(ENTRIES)[0].payload).toMatchObject({ party: 'Acme', po_number: 'PO-1', qty: 500, created_by: 'dispatch@test.local' });
  });

  it('409 with a warning, and nothing saved, when no order line has this PO and PM code', async () => {
    signIn('Dispatch'); orderBook([]);
    const res = await add(ENTRY);
    expect(res.status).toBe(409);
    expect((await res.json()).warnings[0]).toMatch(/No order line/);
    expect(writes()).toHaveLength(0);
  });

  it('409 when the entry would take the line past its order, saved once confirmed', async () => {
    signIn('Dispatch'); orderBook();
    const res = await add({ ...ENTRY, qty: 1_500 });
    expect(res.status).toBe(409);
    expect((await res.json()).warnings[0]).toMatch(/500 more than ordered/);

    expect((await add({ ...ENTRY, qty: 1_500, confirm: true })).status).toBe(200);
    expect(writes(ENTRIES)[0].payload.qty).toBe(1_500);
  });

  it('party, PO and a dispatch status are required', async () => {
    signIn('Dispatch');
    expect((await add({ ...ENTRY, party: ' ' })).status).toBe(400);
    expect((await add({ ...ENTRY, po_number: '' })).status).toBe(400);
    expect((await add({ ...ENTRY, status: 'Packing' })).status).toBe(400);
  });

  it('qty is a whole number of labels above 0, or left out', async () => {
    signIn('Dispatch'); orderBook();
    for (const qty of [-500, 0, 10.5, '500', true]) {
      const res = await add({ ...ENTRY, qty, confirm: true });
      expect(res.status, `qty ${JSON.stringify(qty)}`).toBe(400);
    }
    expect(writes()).toHaveLength(0);

    expect((await add({ ...ENTRY, qty: undefined, confirm: true })).status).toBe(200);
    expect(writes(ENTRIES)[0].payload.qty).toBeNull();
  });
});

describe('PATCH /api/dispatch-notifications/[id]', () => {
  it('409 once the entry has left the queue', async () => {
    signIn('Dispatch');   // the queued-entry lookup finds nothing
    expect((await edit(ENTRY)).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it('saving a remark on an unchanged entry does not ask again', async () => {
    signIn('Dispatch');
    respond((c) => (c.table === ENTRIES && c.op === 'select' ? { data: { ...ENTRY, line_id: null } } : undefined));
    const res = await edit({ ...ENTRY, remark: 'MH-12 AB 1234' });
    expect(res.status).toBe(200);
    expect(writes(ENTRIES)[0].payload).toMatchObject({ remark: 'MH-12 AB 1234', qty: 500 });
  });

  it('refuses a qty that is not a whole number above 0', async () => {
    signIn('Dispatch');
    respond((c) => (c.table === ENTRIES && c.op === 'select' ? { data: { ...ENTRY, line_id: null } } : undefined));
    for (const qty of [-500, 0, 10.5, '500']) {
      expect((await edit({ ...ENTRY, qty, confirm: true })).status, `qty ${JSON.stringify(qty)}`).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });
});
