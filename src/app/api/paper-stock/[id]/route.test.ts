// PATCH / DELETE /api/paper-stock/[id] — correcting one roll on the shelf.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, params, writes } from '@/test/api';
import { PATCH, DELETE } from './route';

const patch = (body: unknown) => PATCH(json('/api/paper-stock/roll-1', 'PATCH', body), params({ id: 'roll-1' }));

describe('PATCH /api/paper-stock/[id]', () => {
  it('401 signed out, 403 without Bill of Material access', async () => {
    expect((await patch({ location: 'R1' })).status).toBe(401);
    signIn('Dispatch');
    expect((await patch({ location: 'R1' })).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('moves the roll and adjusts the metres through the stock function', async () => {
    signIn('Admin');
    const res = await patch({ location: ' R1 ', remaining_meter: '120.456', note: ' recount ' });
    expect(res.status).toBe(200);
    const [move, adjust] = writes();
    expect(move).toMatchObject({ table: 'paper_rolls', op: 'update', payload: { location: 'R1' } });
    expect(adjust).toMatchObject({
      table: 'rpc:adjust_paper_roll',
      payload: { p_roll_id: 'roll-1', p_remaining: 120.46, p_note: 'recount', p_by: 'admin@test.local' },
    });
  });

  it('a bad metre figure saves nothing, not even the new location', async () => {
    signIn('Admin');
    for (const remaining_meter of [-5, '', null, 'lots']) {
      expect((await patch({ location: 'R9', remaining_meter })).status).toBe(400);
    }
    expect(writes()).toHaveLength(0);
  });

  it('passes the stock function\'s own refusal through as 409', async () => {
    signIn('Admin');
    respond((c) => (c.op === 'rpc' ? { error: { code: '22023', message: 'Remaining metres must be between 0 and 500 m' } } : undefined));
    const res = await patch({ remaining_meter: 900 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Remaining metres must be between 0 and 500 m');
  });
});

describe('DELETE /api/paper-stock/[id]', () => {
  const del = () => DELETE(json('/api/paper-stock/roll-1', 'DELETE'), params({ id: 'roll-1' }));

  it('a roll that has been used cannot be deleted', async () => {
    signIn('Admin'); respond((c) => (c.table === 'paper_stock_movements' ? { count: 2 } : undefined));
    expect((await del()).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it('an untouched roll can', async () => {
    signIn('Admin'); respond((c) => (c.table === 'paper_stock_movements' ? { count: 0 } : undefined));
    expect((await del()).status).toBe(200);
    expect(writes('paper_rolls')[0].op).toBe('delete');
  });
});
