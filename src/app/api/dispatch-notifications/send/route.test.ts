// POST /api/dispatch-notifications/send — the consolidated dispatch email.
// Sending is what moves an entry out of the queue (party) or makes it count
// as dispatched (team).

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { signIn, respond, json, writes } from '@/test/api';
import { POST } from './route';
import { sendMail, isMailerConfigured } from '@/lib/notifications/mailer';

vi.mock('@/lib/notifications/mailer', () => ({ isMailerConfigured: vi.fn(() => true), sendMail: vi.fn(async () => ({ id: 'm1' })) }));
vi.mock('@/lib/notifications/dispatchEmailTemplate', () => ({
  getConsolidatedSubject: () => 'subject', getConsolidatedEmailHTML: async () => '<p>html</p>', getDispatchThreadKey: () => 'thread',
}));

const ENTRY = { id: 'e1', party: 'Acme', po_number: 'PO-1', pm_code: 'PM-1', job_name: 'Label', status: 'Dispatched', qty: 500, remark: null };
const ENTRIES = 'pending_dispatch_notifications';

function queue({ contacts = [{ email: 'buyer@acme.test', contact_name: 'Buyer' }], team = [{ email: 'team@novelty.test' }] } = {}) {
  respond((c) => {
    if (c.table === ENTRIES && c.op === 'select') return { data: [ENTRY] };
    if (c.table === 'party_contacts') return { data: contacts };
    if (c.table === 'internal_notification_recipients') return { data: team };
  });
}

const send = (target: 'party' | 'internal') =>
  POST(json('/api/dispatch-notifications/send', 'POST', { party: 'Acme', target }));

beforeEach(() => {
  vi.mocked(sendMail).mockReset().mockResolvedValue({ id: 'm1' });
  vi.mocked(isMailerConfigured).mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('who may send', () => {
  it('401 signed out, 403 for another department', async () => {
    expect((await send('party')).status).toBe(401);
    signIn('QC');
    expect((await send('party')).status).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('party email', () => {
  it('goes to every contact on file and clears the entries from the queue', async () => {
    signIn('Dispatch'); queue();
    const res = await send('party');
    expect(await res.json()).toMatchObject({ sent: true, sent_to_party: true, item_count: 1 });
    expect(vi.mocked(sendMail).mock.calls[0][0].to).toEqual(['buyer@acme.test']);
    expect(writes(ENTRIES)).toHaveLength(1);
    expect(writes(ENTRIES)[0].payload).toHaveProperty('notified_at');
    expect(writes(ENTRIES)[0].filters).toContainEqual(['in', 'id', ['e1']]);
  });

  // Current behaviour, kept on purpose (2026-11-13): party emails aren't in
  // use yet, so a send the mail server refuses still clears the queue.
  // Revisit when party emails go live: the entry should stay queued.
  it('a failed send still clears the entries from the queue, reported as not delivered', async () => {
    signIn('Dispatch'); queue();
    vi.mocked(sendMail).mockRejectedValue(new Error('SMTP timeout'));
    const res = await send('party');
    expect(await res.json()).toMatchObject({ sent: true, sent_to_party: false });
    expect(writes(ENTRIES)[0].payload).toHaveProperty('notified_at');
  });

  it('no contact on file: marked sent, nothing delivered (the queue shows the party as not ready first)', async () => {
    signIn('Dispatch'); queue({ contacts: [] });
    const res = await send('party');
    expect(await res.json()).toMatchObject({ sent: true, sent_to_party: false });
    expect(sendMail).not.toHaveBeenCalled();
    expect(writes(ENTRIES)).toHaveLength(1);
  });

  it('nothing pending', async () => {
    signIn('Dispatch'); respond(() => ({ data: [] }));
    expect(await (await send('party')).json()).toEqual({ skipped: true, reason: 'no_pending' });
  });
});

describe('team email', () => {
  it('is what makes an entry count as dispatched, and leaves it in the queue for the party send', async () => {
    signIn('Dispatch'); queue();
    const res = await send('internal');
    expect(await res.json()).toMatchObject({ sent: true, sent_to_internal: true });
    const [stamp, confirm] = writes(ENTRIES);
    expect(stamp.payload).toHaveProperty('internal_notified_at');
    expect(stamp.payload).not.toHaveProperty('notified_at');
    expect(confirm.payload).toHaveProperty('confirmed_at');
    expect(confirm.filters).toContainEqual(['is', 'confirmed_at', null]);   // a re-send keeps the first date
  });

  // Current behaviour, kept with the party one above: the entry counts as
  // dispatched even when the team email itself failed.
  it('a failed send still counts the entry as dispatched', async () => {
    signIn('Dispatch'); queue();
    vi.mocked(sendMail).mockRejectedValue(new Error('SMTP timeout'));
    const res = await send('internal');
    expect(await res.json()).toMatchObject({ sent: true, sent_to_internal: false });
    expect(writes(ENTRIES).map((c) => Object.keys(c.payload)[0])).toEqual(['internal_notified_at', 'confirmed_at']);
  });
});
