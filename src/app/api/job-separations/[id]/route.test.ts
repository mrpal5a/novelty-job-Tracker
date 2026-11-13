// PATCH /api/job-separations/[id] and POST /api/job-separations/[id]/cancel —
// correcting and cancelling a line on the order worksheet.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, params, writes } from '@/test/api';
import { PATCH } from './route';
import { POST as CANCEL } from './cancel/route';

const ROW = { id: 'row-1', sr_no: 'NOV26-1', party: 'Acme', po_date: '2026-11-01', cancelled_at: null };
const LINES = 'job_separations';

const patch  = (body: unknown) => PATCH(json('/api/job-separations/row-1', 'PATCH', body), params({ id: 'row-1' }));
const cancel = (body: unknown) => CANCEL(json('/api/job-separations/row-1/cancel', 'POST', body), params({ id: 'row-1' }));

describe('PATCH /api/job-separations/[id]', () => {
  it('401 signed out, 403 without the Job Separation permission', async () => {
    expect((await patch({ party: 'X' })).status).toBe(401);
    signIn('QC');
    expect((await patch({ party: 'X' })).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('trims text, keeps paise on the rate, drops the decimals on quantity', async () => {
    signIn('Prepress'); respond(() => ({ data: ROW }));
    const res = await patch({ party: '  Acme  ', po_no: ' PO-9 ', quantity: '5000.7', rate: '1.25', unit: '' });
    expect(res.status).toBe(200);
    expect(writes(LINES)[0].payload).toEqual({ party: 'Acme', po_no: 'PO-9', quantity: 5000, rate: 1.25, unit: null });
  });

  it('party cannot be blanked', async () => {
    signIn('Prepress');
    expect((await patch({ party: '   ' })).status).toBe(400);
  });

  it('PO Date cannot be blanked: the Sr. No. series hangs off it', async () => {
    signIn('Prepress'); respond(() => ({ data: ROW }));
    for (const po_date of ['', null, '   ']) {
      const res = await patch({ po_date });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('PO Date is required');
    }
    expect(writes()).toHaveLength(0);
  });

  it('PO Date must be a real calendar date', async () => {
    signIn('Prepress'); respond(() => ({ data: ROW }));
    for (const po_date of ['13-11-2026', '2026-02-31', 'tomorrow', '2026-13-01']) {
      expect((await patch({ po_date })).status).toBe(400);
    }
    expect(writes()).toHaveLength(0);

    expect((await patch({ po_date: '2026-11-13' })).status).toBe(200);
    expect(writes(LINES)[0].payload).toEqual({ po_date: '2026-11-13' });
  });

  it('404 for a line that does not exist', async () => {
    signIn('Prepress');   // the update matches no row
    const res = await patch({ party: 'Acme' });
    expect(res.status).toBe(404);
  });

  it('409 when the Sr. No. is already on another line', async () => {
    signIn('Prepress'); respond(() => ({ error: { code: '23505', message: 'duplicate key' } }));
    const res = await patch({ sr_no: 'NOV26-2' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Sr. No. NOV26-2 is already on another row');
  });

  it('nothing to change', async () => {
    signIn('Prepress');
    expect((await patch({ not_a_column: 1 })).status).toBe(400);
  });
});

describe('POST /api/job-separations/[id]/cancel', () => {
  it('needs a reason', async () => {
    signIn('Prepress');
    expect((await cancel({ reason: '  ' })).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it('strikes the line out with who and why', async () => {
    signIn('Prepress'); respond(() => ({ data: ROW }));
    const res = await cancel({ reason: ' Duplicate entry ' });
    expect(res.status).toBe(200);
    expect(writes(LINES)[0].payload).toMatchObject({ cancel_reason: 'Duplicate entry', cancelled_by: 'prepress@test.local' });
    expect(writes(LINES)[0].filters).toContainEqual(['is', 'cancelled_at', null]);
  });

  it('409 when it is already cancelled', async () => {
    signIn('Prepress'); respond(() => ({ data: { ...ROW, cancelled_at: '2026-11-02T00:00:00Z' } }));
    expect((await cancel({ reason: 'x' })).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it('404 for a line that does not exist', async () => {
    signIn('Prepress');
    expect((await cancel({ reason: 'x' })).status).toBe(404);
  });

  it('409 when someone else cancelled it in the same moment', async () => {
    signIn('Prepress'); respond((c) => (c.op === 'select' ? { data: ROW } : undefined));
    expect((await cancel({ reason: 'x' })).status).toBe(409);
  });
});
