// src/test/api.ts
// Integration-test harness for route handlers: the real route, the real
// permission code (lib/constants/departments.ts) and the real business rules,
// with only the three doors to Supabase swapped for a recording fake.
//
// Import this file FIRST in a route test: the vi.mock calls below must be
// registered before the route module is loaded.
//
//   import { signIn, respond, json, writes } from '@/test/api';
//   import { POST } from './route';
//
//   beforeEach(() => { signIn('Dispatch'); respond((c) => …); });
//
// ponytail: a recording stub, not an in-memory Postgres. It can't tell you a
// filter is wrong, only what was asked. SQL functions and triggers need a
// real database (PGlite) when one of them is worth testing.

import { beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { invalidateDeptCache } from '@/lib/constants/departments';

export type Call = {
  table:   string;                       // table name, or 'rpc:<function>'
  op:      'select' | 'insert' | 'update' | 'upsert' | 'delete' | 'rpc';
  payload: any;
  filters: [string, ...any[]][];         // every chained call after it, in order
};
type Reply = { data?: unknown; error?: unknown; count?: number } | undefined | void;

const WRITES = ['insert', 'update', 'upsert', 'delete'];

const state = {
  calls: [] as Call[],
  user:  null as { id: string; email: string; app_metadata: Record<string, unknown> } | null,
  reply: (() => undefined) as (c: Call) => Reply,
};

function builder(call: Call): any {
  const self: any = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (ok: any, fail: any) => {
          const res: any = { data: null, error: null, count: null, ...(departments(call) ?? state.reply(call) ?? {}) };
          // What PostgREST does: .single() with no row is an error, .maybeSingle() is not.
          if (res.data == null && !res.error && call.filters.some(([f]) => f === 'single')) {
            res.error = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
          }
          return Promise.resolve(res).then(ok, fail);
        };
      }
      return (...args: any[]) => {
        if (WRITES.includes(prop)) { call.op = prop as Call['op']; call.payload = args[0]; }
        else if (prop !== 'select') call.filters.push([prop, ...args]);
        return self;
      };
    },
  });
  return self;
}

/** The one client every route gets, whether it asked for the session client or the service role. */
export const db = {
  from(table: string) {
    const call: Call = { table, op: 'select', payload: undefined, filters: [] };
    state.calls.push(call);
    return builder(call);
  },
  rpc(fn: string, args?: unknown) {
    const call: Call = { table: `rpc:${fn}`, op: 'rpc', payload: args, filters: [] };
    state.calls.push(call);
    return builder(call);
  },
};

// ── Departments: enough of the real tables for getDeptPermissions to load ──
const dept = (key: string, extra: Record<string, unknown> = {}) => ({
  id: key, key, display_name: key, client_facing_name: key,
  is_super_admin: false, is_read_only: false, all_stages: false, printing_method_scope: null, ...extra,
});
const DEPARTMENTS = [
  dept('Admin', { is_super_admin: true, all_stages: true }),
  dept('Viewer', { is_read_only: true }),
  dept('Prepress'), dept('Dispatch'), dept('QC'), dept('Production'),
];
const FEATURES: Record<string, string[]> = {
  Prepress: ['job_separation_edit', 'job_card_edit'],
  Dispatch: ['dispatch_notifications'],
  QC:       ['shade_card_manage'],
  Production: ['job_card_accept'],
};
const STAGES: Record<string, string[]> = {
  Dispatch:   ['Ready to Dispatch', 'Partial Dispatch', 'Dispatched'],
  Production: ['In Printing', 'Slitting'],
  QC:         ['Quality Check'],
};

function departments(c: Call): Reply {
  if (c.op !== 'select') return undefined;
  if (c.table === 'departments') return { data: DEPARTMENTS };
  if (c.table === 'department_feature_permissions') {
    return { data: Object.entries(FEATURES).flatMap(([d, fs]) => fs.map((feature_key) => ({ department_id: d, feature_key }))) };
  }
  if (c.table === 'department_stage_permissions') {
    return { data: Object.entries(STAGES).flatMap(([d, ss]) => ss.map((stage) => ({ department_id: d, stage }))) };
  }
  if (c.table === 'department_run_stage_permissions') return { data: [] };
  return undefined;
}

// ── What a test sets up ───────────────────────────────────────

/** Sign in as a department ('Admin', 'Dispatch', 'Viewer', …); null signs out. */
export function signIn(department: string | null) {
  state.user = department
    ? { id: `user-${department}`, email: `${department.toLowerCase()}@test.local`, app_metadata: { department } }
    : null;
}

/** Answer the route's queries. Return nothing for "no rows, no error". */
export function respond(reply: (c: Call) => Reply) {
  state.reply = reply;
}

const PERMISSION_TABLES = /^department/;

/** Every write the route made (optionally to one table). */
export function writes(table?: string): Call[] {
  return state.calls.filter((c) => c.op !== 'select' && (!table || c.table === table));
}

/** Every query the route made against one table. */
export function queries(table: string): Call[] {
  return state.calls.filter((c) => c.table === table && !PERMISSION_TABLES.test(c.table));
}

/** A request with a JSON body, as the browser sends it. */
export function json(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://test.local${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The `{ params }` second argument of a dynamic route. */
export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  state.calls = [];
  state.user = null;
  state.reply = () => undefined;
  invalidateDeptCache();
});

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => db }));
vi.mock('@/lib/supabase/admin',  () => ({ createAdminClient: () => db }));
vi.mock('@/lib/supabase/claims', () => ({ getClaimsUser: async () => state.user }));
