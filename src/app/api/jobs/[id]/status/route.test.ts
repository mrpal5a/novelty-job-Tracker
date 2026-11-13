// POST /api/jobs/[id]/status — the route every stage change goes through.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { signIn, respond, json, params, writes, type Call } from '@/test/api';
import { POST } from './route';

const JOB = {
  id: 'job-1', po_number: 'PO-1', pm_code: 'PM-1', party: 'Acme', job_name: 'Label',
  job_type: 'New', status: 'Ready to Dispatch', is_closed: false, is_scheduled_release: false,
  has_partial_runs: false, printing_method: 'Flexo', label_qty: 10_000, dispatched_qty: 0,
  delivery_date: '2026-11-13', slitting_confirmed_at: '2026-11-10T05:00:00Z', updated_at: '2026-11-12T05:00:00Z',
};

/** A job the route can read, save and re-read; every prerequisite stamped. */
function jobIs(job: Partial<typeof JOB>, saved = true) {
  respond((c: Call) => {
    if (c.table === 'jobs') return { data: c.op === 'update' && !saved ? null : { ...JOB, ...job } };
    if (c.table === 'job_stage_timestamps' && c.op === 'select') return { data: { id: 'stamp' } };
  });
}

const change = (body: Record<string, unknown>) =>
  POST(json('/api/jobs/job-1/status', 'POST', body), params({ id: 'job-1' }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T09:30:00Z'));   // 13 Nov, 3:00 PM IST
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('who may change a stage', () => {
  it('401 signed out', async () => {
    expect((await change({ new_status: 'Dispatched' })).status).toBe(401);
  });

  it('403 with the not-your-stage code for a department that does not own the stage', async () => {
    signIn('QC'); jobIs({});
    const res = await change({ new_status: 'Dispatched' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NOT_YOUR_STAGE');
    expect(writes()).toHaveLength(0);
  });

  it('only Admin may skip a prerequisite or move a job back', async () => {
    signIn('Dispatch'); jobIs({});
    expect((await change({ new_status: 'Dispatched', override_prerequisite: true, override_remark: 'x' })).status).toBe(403);
    expect((await change({ new_status: 'Ready to Dispatch', override_backward: true, override_remark: 'x' })).status).toBe(403);
  });
});

describe('the forward-only rule', () => {
  it('409 BACKWARD_MOVE_BLOCKED without the override, and nothing is written', async () => {
    signIn('Admin'); jobIs({ status: 'Packing' });
    const res = await change({ new_status: 'In Printing' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('BACKWARD_MOVE_BLOCKED');
    expect(writes()).toHaveLength(0);
  });

  it('Admin revert clears the stages ahead and writes the reason', async () => {
    signIn('Admin'); jobIs({ status: 'Packing' });
    const res = await change({ new_status: 'In Printing', override_backward: true, override_remark: 'Reprint needed' });
    expect(res.status).toBe(200);
    const cleared = writes('job_stage_timestamps').find((c) => c.op === 'delete')!;
    expect(cleared.filters).toContainEqual(['in', 'stage', expect.arrayContaining(['Slitting', 'Quality Check', 'Packing'])]);
    expect(writes('stage_comments')[0].payload.comment).toBe('[Reverted from "Packing"] Reprint needed');
  });

  it('a revert to before Slitting withdraws the slitting confirmation, so QC waits for Postpress again', async () => {
    signIn('Admin'); jobIs({ status: 'Quality Check' });
    await change({ new_status: 'In Printing', override_backward: true, override_remark: 'Reprint needed' });
    expect(writes('jobs')[0].payload).toMatchObject({ status: 'In Printing', slitting_confirmed_at: null });
  });

  it('a revert that stays at or after Slitting keeps the confirmation', async () => {
    signIn('Admin'); jobIs({ status: 'Packing' });
    await change({ new_status: 'Quality Check', override_backward: true, override_remark: 'Recheck' });
    expect(writes('jobs')[0].payload).not.toHaveProperty('slitting_confirmed_at');
  });

  it('nobody can revert into a dispatch stage', async () => {
    signIn('Admin'); jobIs({ status: 'Dispatched' });
    const res = await change({ new_status: 'Partial Dispatch', qty_dispatched: 5, override_backward: true, override_remark: 'x' });
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe('prerequisites', () => {
  it('Quality Check waits for the slitting confirmation', async () => {
    signIn('QC'); jobIs({ status: 'Slitting', slitting_confirmed_at: null as unknown as string });
    const res = await change({ new_status: 'Quality Check' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'PREREQUISITE_MISSING', missing_stage: 'Slitting' });
  });
});

describe('dispatch', () => {
  it('a part dispatch adds to what already went and queues one entry for the dispatch email', async () => {
    signIn('Dispatch'); jobIs({ dispatched_qty: 4_000 });
    const res = await change({ new_status: 'Partial Dispatch', qty_dispatched: 2_500 });
    expect(res.status).toBe(200);
    expect(writes('jobs')[0].payload).toMatchObject({ status: 'Partial Dispatch', dispatched_qty: 6_500 });
    expect(writes('pending_dispatch_notifications')).toHaveLength(1);
    expect(writes('pending_dispatch_notifications')[0].payload).toMatchObject({ qty: 2_500, po_number: 'PO-1' });
  });

  it('refuses more than is left on the order', async () => {
    signIn('Dispatch'); jobIs({ dispatched_qty: 9_000 });
    const res = await change({ new_status: 'Partial Dispatch', qty_dispatched: 1_001 });
    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it('refuses a quantity that is not a whole number above 0', async () => {
    signIn('Dispatch'); jobIs({});
    for (const qty_dispatched of [0, -5, 10.5, '500', null]) {
      expect((await change({ new_status: 'Partial Dispatch', qty_dispatched })).status).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });

  it('409 JOB_CHANGED when someone else saved the job first, and no log is written', async () => {
    signIn('Dispatch'); jobIs({}, false);
    const res = await change({ new_status: 'Partial Dispatch', qty_dispatched: 100 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('JOB_CHANGED');
    expect(writes('job_status_logs')).toHaveLength(0);
    expect(writes('pending_dispatch_notifications')).toHaveLength(0);
  });

  it('dispatched on the delivery date, in the afternoon, is on time', async () => {
    signIn('Dispatch'); jobIs({});
    await change({ new_status: 'Dispatched' });
    expect(writes('on_time_dispatch_log')[0].payload).toMatchObject({ is_on_time: true, month_key: '2026-11', delivery_date: '2026-11-13' });
  });

  it('dispatched the day after is late', async () => {
    vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
    signIn('Dispatch'); jobIs({});
    await change({ new_status: 'Dispatched' });
    expect(writes('on_time_dispatch_log')[0].payload.is_on_time).toBe(false);
  });
});

describe('Idempotency-Key', () => {
  it('a replay of a change already applied answers with the job and writes nothing', async () => {
    signIn('Dispatch');
    respond((c) => {
      if (c.table === 'job_status_requests') return { error: { code: '23505', message: 'duplicate key' } };
      if (c.table === 'jobs') return { data: JOB };
    });
    const res = await POST(
      json('/api/jobs/job-1/status', 'POST', { new_status: 'Dispatched' }, { 'idempotency-key': '5f0c2a8e-1d2b-4c3d-8e9f-0a1b2c3d4e5f' }),
      params({ id: 'job-1' }),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate).toBe(true);
    expect(writes('jobs')).toHaveLength(0);
  });

  it('a refused change gives its key back', async () => {
    signIn('QC'); jobIs({});
    await POST(
      json('/api/jobs/job-1/status', 'POST', { new_status: 'Dispatched' }, { 'idempotency-key': '5f0c2a8e-1d2b-4c3d-8e9f-0a1b2c3d4e5f' }),
      params({ id: 'job-1' }),
    );
    expect(writes('job_status_requests').map((c) => c.op)).toEqual(['insert', 'delete']);
  });
});
