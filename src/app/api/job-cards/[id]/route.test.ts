// PATCH / DELETE /api/job-cards/[id] and POST a new one — who may do what.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, params, writes } from '@/test/api';
import { PATCH, DELETE } from './route';
import { POST } from '../../job-separations/[id]/job-card/route';

const CARD = { id: 'c1', job_separation_id: 'l1', part: 1, card_number: 'NOV26-55', issued_at: null, updated_at: 't', overrides: {} };
const patch  = (body: unknown) => PATCH(json('/api/job-cards/c1', 'PATCH', body), params({ id: 'c1' }));
const remove = () => DELETE(json('/api/job-cards/c1', 'DELETE', {}), params({ id: 'c1' }));
const create = () => POST(json('/api/job-separations/l1/job-card', 'POST', { direction: 'UNWIND#3' }), params({ id: 'l1' }));

describe('job cards: who may do what', () => {
  it('signed out or without job_card_edit: nothing', async () => {
    for (const call of [() => patch({ direction: 'X' }), remove, create]) expect((await call()).status).toBe(401);
    for (const dept of ['QC', 'Viewer', 'Dispatch']) {
      signIn(dept);
      for (const call of [() => patch({ direction: 'X' }), remove, create]) expect((await call()).status).toBe(403);
    }
    expect(writes('job_cards')).toHaveLength(0);
  });

  it('job_card_edit makes and changes cards but cannot delete one', async () => {
    signIn('Prepress'); respond(() => ({ data: CARD }));
    expect((await create()).status).toBe(201);
    expect((await patch({ direction: 'UNWIND#4', card_number: 'X', issued_at: 'now' })).status).toBe(200);
    expect(writes('job_cards')[1].payload).toEqual({ direction: 'UNWIND#4' });
    const res = await remove();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Only Admin can delete a job card');
    expect(writes('job_cards').some((c) => c.op === 'delete')).toBe(false);
  });

  it('Admin deletes, issued or not', async () => {
    signIn('Admin'); respond(() => ({ data: { id: 'c1' } }));
    expect((await remove()).status).toBe(200);
    expect(writes('job_cards')[0].op).toBe('delete');
  });

  it('an issued card is not edited, even by Admin, until reopened', async () => {
    signIn('Admin'); respond(() => ({ data: { ...CARD, issued_at: '2026-11-25' } }));
    expect((await patch({ direction: 'X' })).status).toBe(409);
    expect((await patch({ action: 'issue' })).status).toBe(409);
    expect(writes('job_cards')).toHaveLength(0);
    expect((await patch({ action: 'reopen' })).status).toBe(200);
    expect(writes('job_cards')[0].payload).toEqual({ details: null, issued_at: null, issued_by: null });
  });

  it('Production accepts the issue it looked at, and makes no other change', async () => {
    const issued_at = '2026-11-25T10:00:00.000+00:00';
    const accept = (seen: unknown = issued_at) => patch({ action: 'accept', issued_at: seen });
    expect((await accept()).status).toBe(401);
    for (const dept of ['Prepress', 'QC', 'Viewer']) { signIn(dept); expect((await accept()).status).toBe(403); }

    signIn('Production'); respond(() => ({ data: { ...CARD, issued_at } }));
    expect((await patch({ direction: 'X' })).status).toBe(403);
    expect((await patch({ action: 'reopen' })).status).toBe(403);
    expect((await accept('2026-11-25T09:00:00Z')).status).toBe(409); // issued again since
    expect((await accept(null)).status).toBe(409);
    expect(writes('job_cards')).toHaveLength(0);
    expect((await accept()).status).toBe(200);
    expect(writes('job_cards')[0].payload).toEqual({ accepted_at: expect.any(String), accepted_by: 'production', edit_request: null });

    respond(() => ({ data: CARD })); // a draft
    expect((await accept()).status).toBe(409);
  });

  it('Production sends the issue it looked at back with a note', async () => {
    const issued_at = '2026-11-25T10:00:00.000+00:00';
    const ask = (note: unknown, seen: unknown = issued_at) => patch({ action: 'ask', issued_at: seen, note });
    for (const dept of ['Prepress', 'QC']) { signIn(dept); expect((await ask('x')).status).toBe(403); }

    signIn('Production'); respond(() => ({ data: { ...CARD, issued_at } }));
    expect((await ask('   ')).status).toBe(400);
    expect((await ask(42)).status).toBe(400);
    expect((await ask('x'.repeat(1001))).status).toBe(400);
    expect((await ask('Die 93', '2026-11-25T09:00:00Z')).status).toBe(409);
    expect(writes('job_cards')).toHaveLength(0);
    expect((await ask('  Die should be 93  ')).status).toBe(200);
    expect(writes('job_cards')[0].payload).toEqual({ edit_request: { note: 'Die should be 93', by: 'production', at: expect.any(String) } });

    respond(() => ({ data: { ...CARD, issued_at, accepted_at: issued_at } }));
    expect((await ask('late')).status).toBe(409);
    respond(() => ({ data: { ...CARD, issued_at, cancelled_at: '2026-11-26' } })); // the line, as read
    expect((await ask('x')).status).toBe(409);
  });

  it('only Admin cancels an acceptance', async () => {
    respond(() => ({ data: { ...CARD, issued_at: '2026-11-25', accepted_at: '2026-11-25' } }));
    for (const dept of ['Prepress', 'Production', 'Viewer']) { signIn(dept); expect((await patch({ action: 'unaccept' })).status).toBe(403); }
    signIn('Admin');
    expect((await patch({ action: 'unaccept' })).status).toBe(200);
    expect(writes('job_cards')[0].payload).toEqual({ accepted_at: null, accepted_by: null });
    respond(() => ({ data: { ...CARD, issued_at: '2026-11-25' } }));
    expect((await patch({ action: 'unaccept' })).status).toBe(409);
  });

  it('an accepted card is closed to everyone, Admin included', async () => {
    signIn('Admin'); respond(() => ({ data: { ...CARD, issued_at: '2026-11-25', accepted_at: '2026-11-25' } }));
    for (const body of [{ direction: 'X' }, { action: 'issue' }, { action: 'reopen' }, { action: 'accept', issued_at: '2026-11-25' }]) {
      expect((await patch(body)).status).toBe(409);
    }
    expect(writes('job_cards')).toHaveLength(0);
  });
});
