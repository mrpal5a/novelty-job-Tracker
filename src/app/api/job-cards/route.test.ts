import { respond, signIn, writes } from '@/test/api';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './route';
import { GET as GET_ONE, PATCH } from './[id]/route';

const ID = '11111111-1111-4111-8111-111111111111', LINE = '22222222-2222-4222-8222-222222222222';
const post = (body: unknown) => POST(new NextRequest('http://x/api/job-cards', { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown) => PATCH(new NextRequest(`http://x/api/job-cards/${ID}`, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: ID }) });

describe('job cards made by hand', () => {
  beforeEach(() => {
    signIn('Prepress');
    respond((c) => (c.op === 'insert' ? { data: { id: ID } } : undefined));
  });

  it('need the job card permission and a job name', async () => {
    signIn('Dispatch');
    expect((await post({ manual: { job_name: 'X' } })).status).toBe(403);
    signIn('Prepress');
    expect((await post({ manual: { party: 'ACME' } })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(writes()).toEqual([]);
  });
  it('are saved without a line', async () => {
    expect((await post({ manual: { job_name: 'X', number: 'JC-7' }, roll_sheet: 'ROLL', plate_id: LINE, job_separation_id: LINE, issued_at: 'now', card_number: 'Z' })).status).toBe(201);
    expect(Object.keys(writes('job_cards')[0].payload).sort()).toEqual(['created_by', 'manual', 'part', 'plate_id', 'roll_sheet']);
  });
  it('only they are linked to an order; a line’s card never becomes manual', async () => {
    const as = (manual: unknown) => respond((c) => (c.table === 'job_cards' ? { data: { id: ID, manual, job_separation_id: manual ? null : LINE, updated_at: 't' } } : undefined));
    as(null);
    expect((await patch({ action: 'link', job_separation_id: LINE })).status).toBe(409);
    expect((await patch({ manual: { job_name: 'X' } })).status).toBe(400); // nothing left to save
    as({ job_name: 'X' });
    expect((await patch({ action: 'link', job_separation_id: 'nope' })).status).toBe(400);
    expect((await patch({ action: 'link', job_separation_id: LINE })).status).toBe(200);
    expect(writes('job_cards').at(-1)?.payload).toEqual({ job_separation_id: LINE });
  });
  it('the empty form is only for those who make cards', async () => {
    const open = () => GET_ONE(new NextRequest('http://x/api/job-cards/new?pm=ZZ9'), { params: Promise.resolve({ id: 'new' }) });
    respond(() => ({ data: [] }));
    signIn('Dispatch');
    expect((await open()).status).toBe(403);
    signIn('Prepress');
    expect((await (await open()).json()).sources).toMatchObject({ line: { id: null, pm_code: 'ZZ9' }, cards: [], linkable: [] });
  });
  it('drafts are listed only for those who make cards', async () => {
    const filters: unknown[] = [];
    respond((c) => { if (c.table === 'job_cards') filters.push(c.filters.some(([f, col]) => f === 'not' && col === 'issued_at')); return { data: [] }; });
    const list = () => GET(new NextRequest('http://x/api/job-cards'));
    signIn('Dispatch'); await list();
    signIn('Prepress'); await list();
    expect(filters).toEqual([true, false]);
  });
});
