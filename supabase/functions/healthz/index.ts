/**
 * /healthz — liveness probe (M3, T10).
 *
 * Unauthenticated by contract (`security: []`). Kong still requires the anon
 * key to route to a function at all, which is gateway policy rather than
 * anything this handler enforces.
 *
 * The probe performs a real round-trip to Postgres rather than returning a
 * static 200. A function that answers "ok" while its database is unreachable
 * is worse than no probe at all: it turns an outage into a silent one.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { err, handleOptions, methodNotAllowed, ok } from '../_shared/response.ts';

// Built once per isolate, not per request. This is the most frequently hit
// endpoint in the service — uptime checkers poll it every few seconds forever —
// and every call was re-reading the environment and constructing a
// byte-identical client, on the one endpoint whose latency is monitored.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const client: SupabaseClient | null =
  SUPABASE_URL && ANON_KEY
    ? createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    : null;

// Read once per isolate, beside the client, for the same reason: this endpoint
// is polled forever. `?? 'unknown'` rather than a hard failure — an unset
// secret should degrade the answer, not take the probe down. The deploy's smoke
// check asserts the value equals the commit it deployed, so 'unknown' fails
// there, which is the right place to notice.
const VERSION = Deno.env.get('PLANPAL_VERSION') ?? 'unknown';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET') return methodNotAllowed();

  if (!client) return unhealthy('configuration');

  // `public.healthz()` rather than a table read: `anon` holds no table grants
  // at all in `public`, so any `.from(...)` here fails with 42501 regardless of
  // whether the database is healthy. The probe function touches nothing and
  // returns a constant, so this still crosses Kong -> PostgREST -> Postgres
  // without granting anonymous callers access to real data.
  const { error } = await client.rpc('healthz');

  if (error) {
    // Logged whole: a PostgREST failure here may be a transport error with no
    // `code`, and destructuring to {code, message} renders that as an empty
    // object, which says nothing useful at 3am.
    console.error('[healthz] database round-trip failed', JSON.stringify(error));
    return unhealthy('database');
  }

  // `version` is declared in `Health` and required there (the contract change
  // landed with this handler, decision E3), so emitting it is no longer the
  // undeclared-field drift that let `isVariableSchedule` diverge — omitting it
  // would now be the drift.
  return ok({ status: 'ok', version: VERSION });
});

/**
 * 503 rather than the ok() envelope: a probe that reports failure with HTTP 200
 * is invisible to every load balancer and uptime checker that looks at status
 * codes, which is most of them.
 *
 * Built with the shared `err()` helper rather than a hand-rolled Response. The
 * previous private copy of the envelope and CORS headers produced a
 * byte-identical result, but would have silently stopped matching the moment
 * either changed — on the one endpoint nothing else exercises.
 */
function unhealthy(reason: string): Response {
  return err('INTERNAL_ERROR', `Service unhealthy: ${reason}.`, 503);
}
