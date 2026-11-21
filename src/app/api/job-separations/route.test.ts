// POST /api/job-separations — a new line on the order worksheet — and
// POST /api/job-separations/[id]/dispatch — labels dispatched against it.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, params, writes } from '@/test/api';
import { GET, POST } from './route';
import { POST as DISPATCH } from './[id]/dispatch/route';

const LINES = 'job_separations';
const ENTRIES = 'pending_dispatch_notifications';

describe('POST /api/job-separations', () => {
  const add = (body: unknown) => POST(json('/api/job-separations', 'POST', body));
  const ROW = { party: 'Acme', po_date: '2026-11-13', po_no: 'PO-1', quantity: 5000, rate: 1.25 };

  it('401 signed out, 403 without the Job Separation permission', async () => {
    expect((await add(ROW)).status).toBe(401);
    signIn('Dispatch');
    expect((await add(ROW)).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('saves the line trimmed, with who added it; the Sr. No. is left to the database', async () => {
    signIn('Prepress'); respond(() => ({ data: { id: 'row-1' } }));
    const res = await add({ ...ROW, party: ' Acme ', pm_code: ' PM-1 ', quantity: '5000', rate: '1.25', unit: '' });
    expect(res.status).toBe(201);
    expect(writes(LINES)[0].payload).toMatchObject({
      sr_no: null, party: 'Acme', po_no: 'PO-1', po_date: '2026-11-13', pm_code: 'PM-1',
      quantity: 5000, rate: 1.25, unit: null, created_by: 'prepress@test.local',
    });
  });

  it('party and PO Date are required', async () => {
    signIn('Prepress');
    expect((await add({ ...ROW, party: ' ' })).status).toBe(400);
    expect((await add({ ...ROW, po_date: '' })).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it('PO Date must be a real calendar date', async () => {
    signIn('Prepress'); respond(() => ({ data: { id: 'row-1' } }));
    for (const po_date of ['13-11-2026', '2026-02-31', 'tomorrow']) {
      const res = await add({ ...ROW, po_date });
      expect(res.status, po_date).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });

  it('409 when a pinned Sr. No. is already taken', async () => {
    signIn('Prepress'); respond(() => ({ error: { code: '23505', message: 'duplicate key' } }));
    const res = await add({ ...ROW, sr_no: 'NOV26-7' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Sr. No. NOV26-7 is already on another row');
  });
});

describe('POST /api/job-separations/[id]/dispatch', () => {
  const LINE = { id: 'line-1', sr_no: 'NOV26-1', party: 'Acme', po_no: 'PO-1', pm_code: 'PM-1', material_name: 'Label', quantity: 1_000, cancelled_at: null };
  // 300 labels went out against this line months ago.
  const EARLIER = { id: 'e0', po_number: 'PO-1', pm_code: 'PM-1', qty: 300, line_id: null, created_at: '2026-01-05T00:00:00Z' };

  function book(line: Record<string, unknown> | null = LINE, entries: unknown[] = [EARLIER]) {
    respond((c) => {
      if (c.table === LINES) return { data: c.filters.some(([f]) => f === 'maybeSingle') ? line : (line ? [line] : []) };
      if (c.table === ENTRIES && c.op === 'select') return { data: entries };
    });
  }
  const dispatch = (body: unknown) =>
    DISPATCH(json('/api/job-separations/line-1/dispatch', 'POST', body), params({ id: 'line-1' }));

  it('403 for a department without the dispatch-quantity permission', async () => {
    signIn('Prepress'); book();
    expect((await dispatch({ qty: 100 })).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('qty is a whole number above 0', async () => {
    signIn('Admin'); book();
    for (const qty of [0, -5, 10.5, '100', null]) {
      expect((await dispatch({ qty })).status, `qty ${JSON.stringify(qty)}`).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });

  it('a part dispatch: linked to this line, counted at once, kept out of the email queue', async () => {
    signIn('Admin'); book();
    const res = await dispatch({ qty: 200 });
    expect(await res.json()).toEqual({ dispatched: 500 });
    const saved = writes(ENTRIES)[0].payload;
    expect(saved).toMatchObject({
      line_id: 'line-1', po_number: 'PO-1', pm_code: 'PM-1', party: 'Acme', qty: 200,
      status: 'Partial Dispatch', created_by: 'admin@test.local',
    });
    expect(saved.confirmed_at).toBeTruthy();
    expect(saved.notified_at).toBe(saved.confirmed_at);
  });

  it('the entry that completes the order is marked Dispatched', async () => {
    signIn('Admin'); book();
    await dispatch({ qty: 700 });
    expect(writes(ENTRIES)[0].payload.status).toBe('Dispatched');
  });

  it('409 with a warning when it would go past the order, saved once confirmed', async () => {
    signIn('Admin'); book();
    const res = await dispatch({ qty: 800 });
    expect(res.status).toBe(409);
    expect((await res.json()).warnings[0]).toMatch(/100 more than ordered/);
    expect(writes()).toHaveLength(0);

    expect(await (await dispatch({ qty: 800, confirm: true })).json()).toEqual({ dispatched: 1_100 });
  });

  it('409 with a warning when the same PO and PM code was entered in the last 3 days', async () => {
    signIn('Admin'); book(LINE, [{ ...EARLIER, created_at: new Date().toISOString() }]);
    const res = await dispatch({ qty: 100 });
    expect(res.status).toBe(409);
    expect((await res.json()).warnings[0]).toMatch(/Already entered/);
  });

  it('refuses a cancelled line, a line with no PO, and a line that is gone', async () => {
    signIn('Admin');
    book({ ...LINE, cancelled_at: '2026-11-01T00:00:00Z' });
    expect((await dispatch({ qty: 100 })).status).toBe(409);
    book({ ...LINE, po_no: '  ' });
    expect((await dispatch({ qty: 100 })).status).toBe(409);
    book(null);
    expect((await dispatch({ qty: 100 })).status).toBe(404);
    expect(writes()).toHaveLength(0);
  });
});

describe('GET /api/job-separations', () => {
  const LINE = { id: 'line-1', party: 'Acme', quantity: 5000, rate: 1.25, order_value: 6250 };
  const list = async () => (await (await GET(json('/api/job-separations?range=all', 'GET'))).json()).job_separations;

  it('a Viewer gets the lines without rate or order value; staff get both', async () => {
    respond((c) => ({ data: c.table === LINES ? [LINE] : [] }));
    signIn('Viewer');
    expect((await list())[0]).toMatchObject({ party: 'Acme', quantity: 5000, rate: null, order_value: null });
    signIn('Prepress');
    expect((await list())[0]).toMatchObject({ rate: 1.25, order_value: 6250 });
  });
});
