// src/lib/supabase/admin.ts
// Service role client — bypasses ALL Row Level Security.
// ONLY import this in API route handlers and server-side code.
// NEVER import in client components. NEVER expose service role key to browser.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ACTOR_HEADER } from '@/lib/identity';

// This is a module-level singleton. In Next.js, API routes are stateless
// per invocation in serverless, so this is instantiated once per cold start.
// Typed <any> deliberately — no generated Database types in this project;
// row shapes are enforced by the interfaces in src/lib/types.ts.
let adminClient: SupabaseClient<any> | null = null;

// Tells the activity log trigger who is writing (migration 089). The client is
// shared across requests, so this runs per call and reads that call's request.
// Writes only: asking for headers() while reading would turn a statically built
// page dynamic. Imported lazily because this file reaches client bundles through
// lib/constants/departments.ts, where a static next/headers import fails the build.
const withActor: typeof fetch = async (input, init) => {
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return fetch(input, init);

  let actor: string | null = null;
  try {
    const { headers } = await import('next/headers');
    actor = headers().get(ACTOR_HEADER);
  } catch {
    // No request behind this call (a script or a test): logged as System.
  }
  if (!actor) return fetch(input, init);

  const merged = new Headers(init?.headers);
  merged.set(ACTOR_HEADER, actor);
  return fetch(input, { ...init, headers: merged });
};

export function createAdminClient() {
  if (adminClient) return adminClient;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  }

  adminClient = createClient<any>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: { fetch: withActor },
    }
  );

  return adminClient;
}
