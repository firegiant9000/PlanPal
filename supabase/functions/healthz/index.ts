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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, handleOptions, methodNotAllowed, ok } from '../_shared/response.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET') return methodNotAllowed();

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return unhealthy('configuration');

  const client = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });

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

  // Only `status` is returned. §6 also describes a version string, but `Health`
  // in openapi.yaml defines `status` alone, and adding an undeclared field is
  // exactly the drift that let `isVariableSchedule` diverge. Adding `version`
  // is a contract change and belongs with one.
  return ok({ status: 'ok' });
});

/**
 * 503 rather than the ok() envelope: a probe that reports failure with HTTP 200
 * is invisible to every load balancer and uptime checker that looks at status
 * codes, which is most of them.
 */
function unhealthy(reason: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: `Service unhealthy: ${reason}.` },
    }),
    { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
  );
}
