import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import { getClaimsUser } from './claims';

const client = (sessionId?: string) => ({
  auth: {
    getClaims: async () => ({
      data: { claims: { sub: 'u1', email: 'a@b.test', session_id: sessionId, app_metadata: { department: 'qc' } } },
      error: null,
    }),
  },
}) as unknown as SupabaseClient;

beforeEach(() => rpc.mockReset());

describe('getClaimsUser — a valid token still needs a live session', () => {
  it('rejects a token whose session is gone (removed login, reset password)', async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await getClaimsUser(client('s-dead'))).toBeNull();
  });

  it('accepts a live session and asks the database once within the cache window', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect((await getClaimsUser(client('s-live')))?.sessionId).toBe('s-live');
    await getClaimsUser(client('s-live'));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a database error does not sign anyone out, and is not cached', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    expect(await getClaimsUser(client('s-err'))).not.toBeNull();
    rpc.mockResolvedValue({ data: false, error: null });
    expect(await getClaimsUser(client('s-err'))).toBeNull();
  });
});
