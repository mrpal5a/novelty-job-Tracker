import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { throw new Error('not in tests'); } }));
import { deliver, isPushEndpoint } from './push';

describe('isPushEndpoint — only real browser push services', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/QGx-abc',
  ])('accepts %s', (u) => expect(isPushEndpoint(u)).toBe(true));

  it.each([
    'https://evil.com/collect',
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evilfcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://user@fcm.googleapis.com/x',
    'https://169.254.169.254/latest',
    'not a url',
  ])('rejects %s', (u) => expect(isPushEndpoint(u)).toBe(false));
});

const row = (endpoint: string) => ({ endpoint, p256dh: 'k', auth: 'a' });
const payload = { title: 'ravi', body: 'x'.repeat(500), tag: 'n1', open: { kind: 'notes' as const } };

describe('deliver — push to every device, report the dead ones', () => {
  it('collects 404/410 endpoints, keeps going past other failures', async () => {
    const sent: string[] = [];
    const gone = await deliver([row('ok'), row('gone'), row('expired'), row('flaky')], payload, async (sub) => {
      sent.push(sub.endpoint);
      if (sub.endpoint === 'gone') throw { statusCode: 410 };
      if (sub.endpoint === 'expired') throw { statusCode: 404 };
      if (sub.endpoint === 'flaky') throw { statusCode: 500 };
    });
    expect(sent).toEqual(['ok', 'gone', 'expired', 'flaky']);
    expect(gone.sort()).toEqual(['expired', 'gone']);
  });

  it('cuts a long body to fit a push payload', async () => {
    let sentBody = '';
    await deliver([row('ok')], payload, async (_sub, body) => { sentBody = body; });
    const parsed = JSON.parse(sentBody);
    expect(parsed.body.length).toBe(240);
    expect(parsed.body.endsWith('…')).toBe(true);
    expect(parsed.open).toEqual({ kind: 'notes' });
  });
});
