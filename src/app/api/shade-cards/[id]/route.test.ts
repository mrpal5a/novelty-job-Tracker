// Shade cards: create (POST /api/shade-cards), edit (PATCH …/[id]), revise
// (POST …/[id]) and delete. The busiest table in the app.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, params, writes } from '@/test/api';
import { POST as CREATE } from '../route';
import { PATCH, POST as REVISE, DELETE } from './route';

const CARDS = 'shade_cards';
const CARD = { id: 'c1', version: 2, status: 'Approved', is_current: true, making_status: 'Pending' };
const FIELDS = { party: 'Acme', product_name: 'Glypho 41% SL', pm_code: 'PM-1' };

const card = (c: Record<string, unknown> | null = CARD) => respond((q) => (q.table === CARDS ? { data: c } : undefined));
const at = params({ id: 'c1' });

const create = (body: unknown) => CREATE(json('/api/shade-cards', 'POST', body));
const patch  = (body: unknown) => PATCH(json('/api/shade-cards/c1', 'PATCH', body), at);
const revise = (body: unknown) => REVISE(json('/api/shade-cards/c1', 'POST', body), at);

describe('POST /api/shade-cards', () => {
  it('401 signed out, 403 without the shade card permission', async () => {
    expect((await create(FIELDS)).status).toBe(401);
    signIn('Dispatch');
    expect((await create(FIELDS)).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('party and product are required', async () => {
    signIn('QC');
    expect((await create({ ...FIELDS, party: ' ' })).status).toBe(400);
    expect((await create({ ...FIELDS, product_name: '' })).status).toBe(400);
  });

  it('starts at version 1, Pending Approval, signed with the login', async () => {
    signIn('QC'); card();
    expect((await create({ ...FIELDS, prepared_date: '2026-11-13', status: 'Nonsense', making_status: 'Nonsense' })).status).toBe(201);
    expect(writes(CARDS)[0].payload).toMatchObject({
      party: 'Acme', product_name: 'Glypho 41% SL', prepared_date: '2026-11-13',
      status: 'Pending Approval', making_status: 'Pending', version: 1, is_current: true,
      created_by: 'user-QC', updated_by_name: 'qc@test.local',
    });
  });

  it('a date that is not a real calendar date is left blank, not sent to the database', async () => {
    signIn('QC'); card();
    await create({ ...FIELDS, prepared_date: '2026-02-31', approval_date: '13-11-2026', sent_to_party_date: 'Tuesday 1', received_back_date: '2026-11-14' });
    expect(writes(CARDS)[0].payload).toMatchObject({
      prepared_date: null, approval_date: null, sent_to_party_date: null, received_back_date: '2026-11-14',
    });
  });
});

describe('PATCH /api/shade-cards/[id]', () => {
  it('403 without the shade card permission', async () => {
    signIn('Dispatch'); card();
    expect((await patch({ action: 'status', status: 'Approved' })).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });

  it('404 for a card that does not exist', async () => {
    signIn('QC'); card(null);
    expect((await patch({ action: 'status', status: 'Approved' })).status).toBe(404);
  });

  it('status: only the statuses still offered', async () => {
    signIn('QC'); card();
    expect((await patch({ action: 'status', status: 'Expired' })).status).toBe(400);
    expect((await patch({ action: 'status', status: 'Approved' })).status).toBe(200);
    expect(writes(CARDS)[0].payload).toEqual({ status: 'Approved', updated_by: 'user-QC', updated_by_name: 'qc@test.local' });
  });

  it('making: a card already made cannot go back to pending', async () => {
    signIn('QC'); card({ ...CARD, making_status: 'Already Made' });
    expect((await patch({ action: 'making', making_status: 'Pending' })).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it('fields: an edit cannot quietly un-make a card either', async () => {
    signIn('QC'); card({ ...CARD, making_status: 'Already Made' });
    expect((await patch({ action: 'fields', ...FIELDS, making_status: 'Pending' })).status).toBe(200);
    expect(writes(CARDS)[0].payload.making_status).toBe('Already Made');
  });

  it('fields: party and product are required, bad dates are left blank', async () => {
    signIn('QC'); card();
    expect((await patch({ action: 'fields', ...FIELDS, party: '' })).status).toBe(400);
    await patch({ action: 'fields', ...FIELDS, approval_date: '2026-02-31' });
    expect(writes(CARDS)[0].payload.approval_date).toBeNull();
  });

  it('an unknown action is refused', async () => {
    signIn('QC'); card();
    expect((await patch({ action: 'delete-everything' })).status).toBe(400);
    expect(writes()).toHaveLength(0);
  });
});

describe('POST /api/shade-cards/[id] (revise)', () => {
  it('creates the next version and retires the old one', async () => {
    signIn('QC'); card();
    expect((await revise(FIELDS)).status).toBe(201);
    const [created, retired] = writes(CARDS);
    expect(created).toMatchObject({ op: 'insert', payload: { version: 3, is_current: true, supersedes_id: 'c1', status: 'Approved', making_status: 'Pending' } });
    expect(retired).toMatchObject({ op: 'update', payload: { is_current: false }, filters: [['eq', 'id', 'c1']] });
  });

  it('409 when this version was already superseded', async () => {
    signIn('QC'); card({ ...CARD, is_current: false });
    expect((await revise(FIELDS)).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it('404 for a card that does not exist', async () => {
    signIn('QC'); card(null);
    expect((await revise(FIELDS)).status).toBe(404);
  });
});

describe('DELETE /api/shade-cards/[id]', () => {
  const del = () => DELETE(json('/api/shade-cards/c1', 'DELETE'), at);

  it('Admin only, even for a department that manages shade cards', async () => {
    signIn('QC');
    expect((await del()).status).toBe(403);
    expect(writes()).toHaveLength(0);
    signIn('Admin');
    expect((await del()).status).toBe(200);
    expect(writes(CARDS)[0].op).toBe('delete');
  });
});
