/**
 * Integration harness for the Edge Functions.
 *
 * These tests call the functions over real HTTP against the local stack
 * (`pnpm db:start`) — no mocks, no stubs, no importing the handler directly.
 * That is the entire point: every critical Month 2 defect (an ON CONFLICT
 * against a partial index that could never match, a recurring event that
 * notified once, broken keyset pagination) was in code that type-checked,
 * linted and shipped without ever being executed.
 *
 * Users are created through the real GoTrue admin API so the `handle_new_user`
 * trigger runs and the `public.users` / `notification_preferences` /
 * `friend_codes` rows exist, exactly as they would after a real signup.
 */

/** Base URL of the local stack's API gateway (Kong). */
export const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';

/**
 * The local stack's keys. These are the fixed, well-known development keys the
 * Supabase CLI generates for every local project — they are not secrets and
 * grant nothing outside this machine. Cloud keys never appear here; §3 scopes
 * the real service-role key to Edge Function secrets only.
 */
export const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export interface TestUser {
  id: string;
  email: string;
  /** A real end-user JWT, as a signed-in client would hold. */
  accessToken: string;
}

export interface FnResponse<T = unknown> {
  status: number;
  /** Parsed `ApiResult` envelope. `null` when the body was not JSON. */
  body: ApiEnvelope<T> | null;
  /** Raw text, for the endpoints that do not return the JSON envelope. */
  text: string;
  headers: Headers;
}

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: Record<string, string[]> } };

/**
 * Fail with an actionable message rather than a bare ECONNREFUSED when the
 * stack is not running. Called once from a global setup hook.
 */
export async function requireLocalStack(): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: ANON_KEY },
    });
    if (!res.ok) throw new Error(`auth health returned ${res.status}`);
  } catch (cause) {
    throw new Error(
      `Cannot reach the local Supabase stack at ${SUPABASE_URL}.\n` +
        `Start it with:  pnpm db:start\n` +
        `Then re-run:    pnpm test:integration\n` +
        `(underlying error: ${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}

let userCounter = 0;

/**
 * Create a confirmed user and return a usable access token.
 *
 * Goes through the admin API rather than inserting into `auth.users` directly,
 * so the signup trigger fires and the profile rows a real user would have exist.
 */
export async function createTestUser(label = 'user'): Promise<TestUser> {
  const email = `it-${label}-${Date.now()}-${userCounter++}@planpal.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) {
    throw new Error(`Failed to create test user: ${created.status} ${await created.text()}`);
  }
  const { id } = (await created.json()) as { id: string };

  const signedIn = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) {
    throw new Error(`Failed to sign in test user: ${signedIn.status} ${await signedIn.text()}`);
  }
  const { access_token: accessToken } = (await signedIn.json()) as { access_token: string };

  return { id, email, accessToken };
}

/** Remove a test user. `public.users` cascades from `auth.users`. */
export async function deleteTestUser(id: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE' | 'OPTIONS';
  /** Omit to call with no Authorization header at all. */
  token?: string;
  body?: unknown;
  query?: Record<string, string>;
  /** Send a raw string body instead of JSON — used to test malformed input. */
  rawBody?: string;
}

/**
 * Invoke an Edge Function route.
 *
 * `path` is the function-relative path, e.g. `events`,
 * `events/<id>/occurrences/2026-09-14`. The edge runtime strips the
 * `/functions/v1` prefix before the handler sees it, so the function's own
 * segment parser reads `events` as segment 0.
 */
export async function callFn<T = unknown>(
  path: string,
  opts: CallOptions = {},
): Promise<FnResponse<T>> {
  const url = new URL(`${SUPABASE_URL}/functions/v1/${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined || opts.rawBody !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.rawBody ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });

  const text = await res.text();
  let body: ApiEnvelope<T> | null = null;
  try {
    body = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    body = null;
  }
  return { status: res.status, body, text, headers: res.headers };
}

/** Narrow a response to its `data`, failing loudly with the server's own error. */
export function expectOk<T>(res: FnResponse<T>, expectedStatus = 200): T {
  if (!res.body || res.body.ok !== true) {
    throw new Error(
      `Expected ok:true (${expectedStatus}) but got ${res.status}: ${res.text.slice(0, 400)}`,
    );
  }
  if (res.status !== expectedStatus) {
    throw new Error(`Expected status ${expectedStatus} but got ${res.status}`);
  }
  return res.body.data;
}

/** Narrow a response to its error, failing loudly if the call unexpectedly succeeded. */
export function expectErr<T>(res: FnResponse<T>, expectedStatus: number) {
  if (!res.body || res.body.ok !== false) {
    throw new Error(
      `Expected ok:false (${expectedStatus}) but got ${res.status}: ${res.text.slice(0, 400)}`,
    );
  }
  if (res.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus} but got ${res.status} (${res.body.error.code})`,
    );
  }
  return res.body.error;
}

/** A valid master-event body, overridable per test. */
export function eventFixture(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Weekly standup',
    localStart: '2026-09-07T09:00:00',
    localEnd: '2026-09-07T09:30:00',
    timezoneId: 'America/New_York',
    visibility: 'private',
    ...overrides,
  };
}
