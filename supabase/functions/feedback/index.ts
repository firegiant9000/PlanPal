/**
 * /feedback — in-app user feedback / bug reports (M5 cross-cutting: user
 * support & feedback loop).
 *
 * Routes:
 *   POST /feedback   submit a feedback message, with optional client context
 *
 * Triage (reading across all users, changing status) happens outside this
 * API — the Supabase dashboard or a future admin surface, using the service
 * role, which bypasses RLS. This function only ever acts as the caller, so it
 * can only ever see or write the caller's own row (see the `feedback`
 * migration for the policy set).
 */
import { getUserClient, type DbClient } from '../_shared/auth.ts';
import { readJsonObject } from '../_shared/body.ts';
import type { Json } from '../_shared/database.types.ts';
import {
  badRequest,
  err,
  handleOptions,
  methodNotAllowed,
  ok,
  unauthenticated,
} from '../_shared/response.ts';

const DAILY_LIMIT = 20;
const MAX_MESSAGE_LENGTH = 2000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return methodNotAllowed();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const message = body.message;
  if (typeof message !== 'string' || message.trim() === '') {
    return badRequest('"message" is required and must be a non-empty string.');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return badRequest(`"message" must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  const context = body.context;
  const contextIsObject =
    context === undefined || (typeof context === 'object' && context !== null && !Array.isArray(context));
  if (!contextIsObject) {
    return badRequest('"context", when present, must be a JSON object.');
  }

  const limited = await isRateLimited(client, userId);
  if (limited) {
    return err(
      'RATE_LIMITED',
      `Feedback limit reached. You may submit up to ${DAILY_LIMIT} messages per 24 hours.`,
      429,
    );
  }

  const { data: row, error: insertError } = await client
    .from('feedback')
    .insert({
      user_id: userId,
      message,
      // Parsed JSON body already, so it is Json by construction (same
      // reasoning `events/index.ts` uses for its RPC's jsonb parameter).
      context: (context ?? null) as Json | null,
    })
    .select('id, message, created_at')
    .single();

  if (insertError || !row) {
    console.error('[feedback:create] insert failed', insertError);
    return err('INTERNAL_ERROR', 'Failed to record feedback.', 500);
  }

  return ok({ id: row.id, message: row.message, createdAt: row.created_at }, 201);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isRateLimited(client: DbClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await client
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) {
    // Allow on DB error — do not penalise the user for an infrastructure hiccup.
    console.error('[feedback:rate-limit] count query failed', error);
    return false;
  }
  return (count ?? 0) >= DAILY_LIMIT;
}
