// The gate in front of every request: who gets in without a session (cron,
// internal notification calls, /track), who is turned away (Viewer writes),
// and the actor header only the middleware may set.

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { signIn } from '@/test/api';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';
import { ACTOR_HEADER } from '@/lib/identity';

// The session client is only handed to getClaimsUser, which the harness answers.
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({}) }));

const SECRET = 'test-cron-secret';

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`https://noveltytracker.com${path}`, init);
}

/** Middleware let the request through to the route. */
const passed = (res: Response) => res.headers.get('x-middleware-next') === '1';
/** A header the middleware forwarded to the route. */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

beforeEach(() => { process.env.CRON_SECRET = SECRET; });

describe('/api/cron/*', () => {
  it('lets Vercel Cron in: it sends Authorization: Bearer <CRON_SECRET>', async () => {
    const res = await middleware(req('/api/cron/overdue-check', { headers: { authorization: `Bearer ${SECRET}` } }));
    expect(passed(res)).toBe(true);
  });

  it('still accepts the x-cron-secret header', async () => {
    const res = await middleware(req('/api/cron/overdue-check', { headers: { 'x-cron-secret': SECRET } }));
    expect(passed(res)).toBe(true);
  });

  it('401 with no secret or the wrong one', async () => {
    expect((await middleware(req('/api/cron/overdue-check'))).status).toBe(401);
    expect((await middleware(req('/api/cron/overdue-check', { headers: { authorization: 'Bearer nope' } }))).status).toBe(401);
    expect((await middleware(req('/api/cron/overdue-check', { headers: { 'x-cron-secret': 'nope' } }))).status).toBe(401);
  });

  it('401 for everyone when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const attempts: Record<string, string>[] = [{}, { authorization: 'Bearer undefined' }, { authorization: 'Bearer ' }, { 'x-cron-secret': '' }, { 'x-cron-secret': 'undefined' }];
    for (const headers of attempts) {
      expect((await middleware(req('/api/cron/overdue-check', { headers }))).status).toBe(401);
    }
  });
});

describe('/api/notifications/*', () => {
  it('internal calls only', async () => {
    expect((await middleware(req('/api/notifications/email', { method: 'POST' }))).status).toBe(401);
    const res = await middleware(req('/api/notifications/email', { method: 'POST', headers: { 'x-internal-secret': SECRET } }));
    expect(passed(res)).toBe(true);
  });

  it('401 when CRON_SECRET is not configured, even with an empty header', async () => {
    delete process.env.CRON_SECRET;
    const res = await middleware(req('/api/notifications/email', { method: 'POST', headers: { 'x-internal-secret': '' } }));
    expect(res.status).toBe(401);
  });
});

describe('/api/* writes', () => {
  it('a Viewer is refused', async () => {
    signIn('Viewer');
    const res = await middleware(req('/api/jobs', { method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('a Viewer can still read, and register a device for notifications', async () => {
    signIn('Viewer');
    expect(passed(await middleware(req('/api/jobs')))).toBe(true);
    expect(passed(await middleware(req('/api/push', { method: 'POST' })))).toBe(true);
  });

  it('the actor header is the signed-in user, never what the caller sent', async () => {
    signIn('Dispatch');
    const res = await middleware(req('/api/jobs', { method: 'POST', headers: { [ACTOR_HEADER]: 'someone-else' } }));
    expect(passed(res)).toBe(true);
    expect(forwarded(res, ACTOR_HEADER)).toBe('user-Dispatch');
  });

  it('a signed-out write carries no actor header, whatever was sent', async () => {
    const res = await middleware(req('/api/jobs', { method: 'POST', headers: { [ACTOR_HEADER]: 'someone-else' } }));
    expect(passed(res)).toBe(true);
    expect(forwarded(res, ACTOR_HEADER)).toBeNull();
  });
});

describe('pages', () => {
  it('/admin and /display need a session', async () => {
    for (const path of ['/admin/jobs', '/display/1']) {
      const res = await middleware(req(path));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(`https://noveltytracker.com/login?redirectTo=${encodeURIComponent(path)}`);
    }
  });

  it('/track is public', async () => {
    expect(passed(await middleware(req('/track/PO123')))).toBe(true);
  });

  it('/ sends a signed-in user to the panel and everyone else to tracking', async () => {
    expect((await middleware(req('/'))).headers.get('location')).toBe('https://noveltytracker.com/track');
    signIn('Dispatch');
    expect((await middleware(req('/'))).headers.get('location')).toBe('https://noveltytracker.com/admin');
  });
});
