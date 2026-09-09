import { createHmac } from 'node:crypto';
import { createPlanPalClient, PlanPalApiError } from '@planpal/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  deleteTestUser,
  requireLocalStack,
} from './harness';

/**
 * The refresh path, against the real gateway.
 *
 * `packages/api-client`'s unit suite stubs `fetch`, so it proves the client's
 * logic and nothing about Kong. That matters here more than anywhere else,
 * because **the 401 this client meets in production is not the contract's**:
 * for an expired or malformed JWT the gateway answers before our handler runs,
 * with its own body shape and no `ok` field. A client that reads `body.ok`
 * before deciding whether to refresh throws on that body and signs the user
 * out for no reason.
 *
 * Waiting an hour for a token to expire is not a test, so the expired token is
 * minted locally with the stack's well-known JWT secret.
 */

/**
 * The Supabase CLI's fixed local development secret. Not a secret in any
 * meaningful sense — it is the same on every developer's machine and grants
 * nothing beyond localhost. A cloud JWT secret must never appear here.
 */
const LOCAL_JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * A structurally valid, correctly signed, already-expired end-user JWT.
 *
 * `node:crypto` rather than a JWT library: an HMAC-SHA256 over two base64url
 * segments is the whole algorithm, and a dependency added for one test in one
 * spec is a dependency the whole repo carries.
 */
function mintExpiredAccessToken(userId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000) - 7200;
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: `${SUPABASE_URL}/auth/v1`,
      sub: userId,
      aud: 'authenticated',
      role: 'authenticated',
      iat: issuedAt,
      exp: issuedAt + 3600, // one hour ago
      session_id: '00000000-0000-0000-0000-0000000000ff',
    }),
  );
  const signature = base64url(
    createHmac('sha256', LOCAL_JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${signature}`;
}

interface SignedInUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Create a confirmed user and keep the refresh token.
 *
 * The harness's `createTestUser` discards it, and this is the one spec that
 * needs it. Kept local rather than widening shared test infrastructure that
 * 195 other assertions depend on.
 */
async function createSignedInUser(label: string): Promise<SignedInUser> {
  const email = `it-apiclient-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@planpal.test`;
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
  const session = (await signedIn.json()) as { access_token: string; refresh_token: string };

  return { id, email, accessToken: session.access_token, refreshToken: session.refresh_token };
}

/** A real GoTrue refresh, as `AuthClient.refresh` performs internally. */
function refreshWith(refreshToken: string): () => Promise<string | null> {
  return async () => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { access_token?: string };
    return body.access_token ?? null;
  };
}

/**
 * Count the client's requests without stubbing them.
 *
 * "Does not loop" has to be asserted, not assumed — a client that hammers the
 * gateway with a dead refresh token looks identical to one that fails cleanly
 * unless somebody counts.
 */
function countingFetch() {
  const real = globalThis.fetch;
  const calls: string[] = [];
  // Parameters<typeof fetch> rather than `RequestInfo`: this tsconfig's lib
  // set does not declare the DOM alias, and widening it for one test would
  // change what every other spec in this package can reference.
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push(String(input));
    return real(input, init);
  }) as typeof fetch;
  return {
    calls,
    /** Only the client's own calls to the functions gateway. */
    functionCalls: () => calls.filter((url) => url.includes('/functions/v1/')),
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

function clientFor(accessToken: string, refresh: () => Promise<string | null>) {
  return createPlanPalClient({
    supabaseUrl: SUPABASE_URL,
    anonKey: ANON_KEY,
    getAccessToken: () => Promise.resolve(accessToken),
    refresh,
  });
}

let userA: SignedInUser;
let userB: SignedInUser;

beforeAll(async () => {
  await requireLocalStack();
  userA = await createSignedInUser('a');
  userB = await createSignedInUser('b');
});

afterAll(async () => {
  if (userA) await deleteTestUser(userA.id);
  if (userB) await deleteTestUser(userB.id);
});

describe('the api-client against the real gateway', () => {
  it('refreshes a gateway-rejected access token and retries once', async () => {
    const expired = mintExpiredAccessToken(userA.id);
    const spy = countingFetch();
    try {
      const client = clientFor(expired, refreshWith(userA.refreshToken));

      const page = await client.events.list({ limit: 5 });

      expect(Array.isArray(page.items)).toBe(true);
      // Exactly two: the 401 and the retry. The refresh itself goes to
      // /auth/v1, which is why only the functions calls are counted.
      expect(spy.functionCalls()).toHaveLength(2);
    } finally {
      spy.restore();
    }
  });

  it('is really the gateway answering, not our handler', async () => {
    // The premise of the whole design, and it holds for BOTH kinds of bad
    // token — with a different `code` for each, which is exactly why the
    // client keys off the status and never off the gateway's code string:
    //
    //   malformed -> {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT", ...}
    //   expired   -> {"code":"UNAUTHORIZED_LEGACY_JWT", ...}
    //
    // Neither carries `ok`. If either ever grows one, the "refresh on any 401
    // regardless of body shape" rule stops being necessary — and while they do
    // not, a body-shape-first client is broken in production with its unit
    // tests green.
    const bad = {
      malformed: 'not-a-jwt',
      expired: mintExpiredAccessToken(userA.id),
    };

    for (const [label, token] of Object.entries(bad)) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/events`, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      });
      const body = (await res.json()) as Record<string, unknown>;

      expect(res.status, label).toBe(401);
      expect(body, label).not.toHaveProperty('ok');
      expect(typeof body.message, label).toBe('string');
    }
  });

  it('throws rather than looping when the session cannot be renewed', async () => {
    // A refresh token the server will not honour. The client must fail with a
    // typed error and stop — never retry into a loop.
    const expired = mintExpiredAccessToken(userA.id);
    const spy = countingFetch();
    try {
      const client = clientFor(expired, refreshWith('not-a-real-refresh-token'));

      const error = await client.events.list().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PlanPalApiError);
      expect((error as PlanPalApiError).code).toBe('UNAUTHENTICATED');
      expect((error as PlanPalApiError).status).toBe(401);
      expect(spy.functionCalls().length).toBeLessThanOrEqual(2);
    } finally {
      spy.restore();
    }
  });

  it('serves whichever identity the refresh returns, since the subject is never cross-checked', async () => {
    // Handed user A's expired access token and user B's refresh token, the
    // client refreshes into B's session and retries as B. That is correct —
    // a token is the identity, and nothing in the client claims otherwise —
    // but it is worth pinning: the access token's `sub` is not compared
    // against the refreshed one. In the app the pair always comes from one
    // stored session (`AuthClient.refresh`), so a mismatch cannot arise.
    const expired = mintExpiredAccessToken(userA.id);
    const spy = countingFetch();
    try {
      const client = clientFor(expired, refreshWith(userB.refreshToken));

      const page = await client.events.list({ limit: 5 });

      expect(Array.isArray(page.items)).toBe(true);
      expect(spy.functionCalls()).toHaveLength(2);
    } finally {
      spy.restore();
    }
  });
});
