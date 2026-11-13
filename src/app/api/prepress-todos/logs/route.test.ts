// GET /api/prepress-todos/logs and POST /api/prepress-todos/logs/export —
// the to-do history. Export can also clear what it exported, so the search
// that picks the rows decides what gets deleted.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, queries, writes } from '@/test/api';
import { GET } from './route';
import { POST as EXPORT } from './export/route';
import { orContains } from '@/lib/search';

const LOGS = 'prepress_todo_logs';
const LOG = { id: 'l1', task: 'Plate, die (new) for PM-1', action: 'created', actor_email: 'a@test.local', actor_department: 'Prepress', created_at: '2026-11-13T05:00:00Z' };
const TYPED = 'Plate, die (new)';
const FILTER = ['or', orContains(['task', 'actor_email', 'actor_department'], TYPED)];

const list   = (q: string) => GET(json(`/api/prepress-todos/logs?${new URLSearchParams({ q })}`, 'GET'));
const exportCsv = (body: unknown) => EXPORT(json('/api/prepress-todos/logs/export', 'POST', body));

describe('GET /api/prepress-todos/logs', () => {
  it('401 signed out, 403 without the to-do permission', async () => {
    expect((await list('x')).status).toBe(401);
    signIn('Dispatch');
    expect((await list('x')).status).toBe(403);
  });

  it('keeps commas and brackets in the search as typed', async () => {
    signIn('Admin'); respond(() => ({ data: [LOG], count: 9 }));
    expect(await (await list(TYPED)).json()).toEqual({ logs: [LOG], total: 9 });
    expect(queries(LOGS)[0].filters).toContainEqual(FILTER);
  });
});

describe('POST /api/prepress-todos/logs/export', () => {
  it('exports the same rows the search shows', async () => {
    signIn('Admin'); respond(() => ({ data: [LOG] }));
    const res = await exportCsv({ q: TYPED });
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(await res.text()).toContain('"Plate, die (new) for PM-1",Added,a@test.local,Prepress,13-11-2026 10:30');
    expect(queries(LOGS)[0].filters).toContainEqual(FILTER);
  });

  it('deletes nothing unless asked to clear', async () => {
    signIn('Admin'); respond(() => ({ data: [LOG] }));
    const res = await exportCsv({});
    expect(res.headers.get('x-cleared-count')).toBe('0');
    expect(writes()).toHaveLength(0);
  });

  it('clear deletes exactly the rows it exported', async () => {
    signIn('Admin'); respond(() => ({ data: [LOG] }));
    const res = await exportCsv({ clear: true });
    expect(res.headers.get('x-cleared-count')).toBe('1');
    expect(writes(LOGS)).toHaveLength(1);
    expect(writes(LOGS)[0]).toMatchObject({ op: 'delete', filters: [['in', 'id', ['l1']]] });
  });

  it('a Viewer-level department cannot export or clear', async () => {
    signIn('QC');
    expect((await exportCsv({ clear: true })).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});
