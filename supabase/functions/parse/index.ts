/**
 * /parse — screenshot-to-schedule upload flow (M5, Step 1).
 *
 * Routes:
 *   POST /parse/upload-url   generate a presigned URL for direct storage upload
 *   POST /parse              enqueue a parse job after the upload completes
 *   GET  /parse/{jobId}      poll job status
 *
 * The pipeline runs entirely server-side so the model can be upgraded without
 * an app release. Stages 1–4 (OCR → extraction → normalisation → conflicts)
 * are implemented in the parse-worker function (M5, Steps 2–5).
 *
 * Cross-cutting (cost monitoring): both POST routes also check a global
 * spend kill-switch (`_shared/spend.ts`) before the per-user rate limit —
 * see `isSpendCapped`.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { getUserClient, type DbClient } from '../_shared/auth.ts';
import { readJsonObject } from '../_shared/body.ts';
import {
  badRequest,
  err,
  handleOptions,
  methodNotAllowed,
  notFound,
  ok,
  unauthenticated,
} from '../_shared/response.ts';
import { isSpendCapped } from '../_shared/spend.ts';

const SPEND_CAPPED_MESSAGE =
  'Screenshot scanning is temporarily paused due to high demand. Please try again later.';

const DAILY_LIMIT = 15;
const UPLOAD_URL_TTL_SECONDS = 60;

// UUID v4 pattern — used to validate the jobId path segment before querying.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const url = new URL(req.url);
  // segments[0] = 'parse', [1] = 'upload-url' | jobId | undefined
  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  const sub = segments[1] ?? null;

  if (sub === 'upload-url') {
    if (req.method !== 'POST') return methodNotAllowed();
    return handleCreateUploadUrl(client, userId);
  }

  if (sub === null) {
    if (req.method !== 'POST') return methodNotAllowed();
    return handleCreateJob(client, userId, req);
  }

  // sub is treated as a jobId
  if (req.method !== 'GET') return methodNotAllowed();
  return handleGetJob(client, sub);
});

// ---------------------------------------------------------------------------
// POST /parse/upload-url
// ---------------------------------------------------------------------------

async function handleCreateUploadUrl(client: DbClient, userId: string): Promise<Response> {
  const admin = makeAdminClient();
  if (!admin) {
    console.error('[parse:upload-url] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
    return err('INTERNAL_ERROR', 'Storage configuration error.', 500);
  }

  // Cross-cutting: cost monitoring & budget alerts — a global spend cap takes
  // precedence over the per-user rate limit below, since it's a system-wide
  // "we are pausing all new scans" condition, not a per-caller one.
  if (await isSpendCapped(admin)) {
    return err('SERVICE_UNAVAILABLE', SPEND_CAPPED_MESSAGE, 503);
  }

  const limited = await isRateLimited(client, userId);
  if (limited) {
    return err('RATE_LIMITED', 'Parse limit reached. You may submit up to 15 screenshots per 24 hours.', 429);
  }

  // Service role is required for Supabase Storage's signed-upload-URL
  // endpoint. The path is scoped to the user's own prefix so the ownership
  // convention (screenshots/<userId>/…) is preserved.
  const storagePath = `${userId}/${crypto.randomUUID()}`;

  const { data, error } = await admin.storage
    .from('screenshots')
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error('[parse:upload-url] createSignedUploadUrl failed', error);
    return err('INTERNAL_ERROR', 'Failed to generate upload URL.', 500);
  }

  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();

  return ok({
    uploadUrl: data.signedUrl,
    storagePath: data.path,
    expiresAt,
  });
}

// ---------------------------------------------------------------------------
// POST /parse
// ---------------------------------------------------------------------------

async function handleCreateJob(client: DbClient, userId: string, req: Request): Promise<Response> {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const storagePath = body.storagePath;
  if (typeof storagePath !== 'string' || storagePath.trim() === '') {
    return badRequest('"storagePath" is required and must be a non-empty string.');
  }

  // The storage path must be owned by this user: the first segment is the
  // userId. This prevents a user from enqueuing jobs against another user's
  // uploaded files even if they somehow obtained the path.
  const pathOwnerId = storagePath.split('/')[0];
  if (pathOwnerId !== userId) {
    return badRequest('"storagePath" must be under your own user prefix.');
  }

  // Same global spend cap as upload-url. `admin` can be null here (missing
  // service-role config) without failing the request — this handler doesn't
  // otherwise need service-role access, so a kill-switch misconfiguration
  // fails open rather than taking POST /parse down with it.
  const admin = makeAdminClient();
  if (admin && (await isSpendCapped(admin))) {
    return err('SERVICE_UNAVAILABLE', SPEND_CAPPED_MESSAGE, 503);
  }

  const limited = await isRateLimited(client, userId);
  if (limited) {
    return err('RATE_LIMITED', 'Parse limit reached. You may submit up to 15 screenshots per 24 hours.', 429);
  }

  const { data: job, error: insertError } = await client
    .from('parse_jobs')
    .insert({ user_id: userId, storage_path: storagePath })
    .select()
    .single();

  if (insertError || !job) {
    console.error('[parse:create] insert failed', insertError);
    return err('INTERNAL_ERROR', 'Failed to create parse job.', 500);
  }

  // Push job to Upstash Redis so the parse-worker can pick it up immediately.
  // Non-fatal: if Redis is not configured the job row still exists and can be
  // picked up by a polling fallback. Logged as a warning, not an error.
  await enqueueToRedis(job.id, userId, storagePath);

  return ok(toParseJobModel(job), 201);
}

// ---------------------------------------------------------------------------
// GET /parse/{jobId}
// ---------------------------------------------------------------------------

async function handleGetJob(client: DbClient, jobId: string): Promise<Response> {
  if (!UUID_RE.test(jobId)) return notFound('Parse job');

  const { data, error } = await client
    .from('parse_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    console.error('[parse:get] select failed', error);
    return err('INTERNAL_ERROR', 'Failed to retrieve parse job.', 500);
  }
  if (!data) return notFound('Parse job');

  return ok(toParseJobModel(data));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Null when service-role credentials aren't configured — callers decide how to react. */
function makeAdminClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function isRateLimited(client: DbClient, userId: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Count ALL rows regardless of status. One user submission = one row = one slot.
  // Worker retries reuse the same row (updating retry_count), so they never
  // inflate this count. Failed jobs also hold their slot — the limit is on how
  // many parses a user can submit, not how many succeed.
  const { count, error } = await client
    .from('parse_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) {
    // Allow on DB error — do not penalise the user for an infrastructure hiccup.
    console.error('[parse:rate-limit] count query failed', error);
    return false;
  }
  return (count ?? 0) >= DAILY_LIMIT;
}

async function enqueueToRedis(jobId: string, userId: string, storagePath: string): Promise<void> {
  const redisUrl = Deno.env.get('UPSTASH_REDIS_REST_URL');
  const redisToken = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
  if (!redisUrl || !redisToken) {
    console.warn('[parse:enqueue] UPSTASH_REDIS_REST_URL/TOKEN not set — job queued in DB only.');
    return;
  }

  const payload = JSON.stringify({ jobId, userId, storagePath });
  try {
    const res = await fetch(redisUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json',
      },
      // Upstash Redis REST API: POST the command array to the project URL.
      body: JSON.stringify(['LPUSH', 'parse:queue', payload]),
    });
    if (!res.ok) {
      console.error('[parse:enqueue] Redis LPUSH failed', res.status, await res.text());
    }
  } catch (e) {
    console.error('[parse:enqueue] Redis LPUSH exception', e);
  }
}

type ParseJobRow = {
  id: string;
  status: string;
  event_count: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
};

function toParseJobModel(row: ParseJobRow) {
  return {
    jobId: row.id,
    status: row.status,
    ...(row.event_count !== null ? { eventCount: row.event_count } : {}),
    ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
