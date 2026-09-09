import type { ApiError, ApiResult } from '@planpal/types';
import { mapNonEnvelopeError, PlanPalApiError } from './errors';

export interface HttpOptions {
  /** e.g. http://127.0.0.1:54321/functions/v1 */
  baseUrl: string;
  anonKey: string;
  getAccessToken(): Promise<string | null>;
  /** Resolves to a new access token, or null when the session cannot be renewed. */
  refresh(): Promise<string | null>;
}

export interface RequestInitLike {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
}

export interface Http {
  json<T>(path: string, init?: RequestInitLike): Promise<T>;
  text(path: string, init?: { query?: Record<string, string> }): Promise<string>;
  empty(path: string, init?: { method?: string }): Promise<void>;
}

/** A response already drained to text, so the body can be inspected more than once. */
interface RawResponse {
  status: number;
  body: string;
}

/**
 * The one place in the codebase that touches the network (§15, enforced by lint
 * in B5).
 *
 * Hand-rolled rather than built on `openapi-fetch` for one reason: "refresh
 * once, retry once, never loop" has to be exactly right, and it is awkward to
 * express in a middleware chain. The cost of that choice is that route paths
 * are typed by hand per resource; B6's integration test against the real stack
 * is what stands in for the type system there.
 */
export function createHttp(opts: HttpOptions): Http {
  /**
   * Send, and on ANY 401 refresh once and retry once — regardless of the body's
   * shape.
   *
   * That last part is the whole point. For an expired or malformed JWT the
   * gateway answers, not our handler, and its body has no `ok` field:
   * `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT", ...}`. A client that reads
   * `body.ok` before deciding whether to refresh throws on that body and the
   * user is signed out for no reason. The status is the trigger; the body is
   * not consulted.
   *
   * At most two `fetch` calls per logical request, always. A loop here is a
   * client that hammers the gateway with a dead refresh token.
   */
  async function send(path: string, init: RequestInitLike): Promise<RawResponse> {
    const first = await once(path, init, await opts.getAccessToken());
    if (first.status !== 401) return first;

    const renewed = await opts.refresh();
    // No new token: retrying would send the same credentials and get the same
    // answer, so fail here rather than spending a second round-trip on it.
    if (renewed === null) {
      throw new PlanPalApiError('UNAUTHENTICATED', 'Session expired. Sign in again.', 401);
    }

    const second = await once(path, init, renewed);
    if (second.status === 401) {
      throw new PlanPalApiError(
        'UNAUTHENTICATED',
        'Session expired and could not be renewed. Sign in again.',
        401,
      );
    }
    return second;
  }

  async function once(
    path: string,
    init: RequestInitLike,
    accessToken: string | null,
  ): Promise<RawResponse> {
    const url = new URL(`${trimEnd(opts.baseUrl)}/${trimStart(path)}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = { apikey: opts.anonKey };
    if (accessToken !== null) headers.Authorization = `Bearer ${accessToken}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    // Drained once, here. React Native's `fetch` gives a one-shot body, and a
    // response read twice is a runtime error the unit tests would not catch.
    return { status: res.status, body: await res.text() };
  }

  return {
    async json<T>(path: string, init: RequestInitLike = {}): Promise<T> {
      const res = await send(path, init);
      const envelope = parseEnvelope<T>(res.body);

      // Not our envelope: a gateway 404, a proxy's HTML 502, an upstream
      // error page. Never `JSON.parse` blindly — a SyntaxError here would
      // replace a diagnosable 502 with a mystery.
      if (envelope === null) throw mapNonEnvelopeError(res.status, res.body);

      if (!envelope.ok) {
        throw new PlanPalApiError(
          envelope.error.code,
          envelope.error.message,
          res.status,
          envelope.error.details,
        );
      }
      return envelope.data;
    },

    async text(path: string, init: { query?: Record<string, string> } = {}): Promise<string> {
      const res = await send(path, init);
      if (!isSuccess(res.status)) throw errorFrom(res);
      // A string, never a Blob: React Native's `fetch` has partial Blob
      // support, so `export.ical` returning a Blob would work on web and fail
      // on a phone (specs §B).
      return res.body;
    },

    async empty(path: string, init: { method?: string } = {}): Promise<void> {
      const res = await send(path, init);
      if (!isSuccess(res.status)) throw errorFrom(res);
    },
  };
}

function errorFrom(res: RawResponse): PlanPalApiError {
  const envelope = parseEnvelope<unknown>(res.body);
  if (envelope === null || envelope.ok) return mapNonEnvelopeError(res.status, res.body);
  return new PlanPalApiError(
    envelope.error.code,
    envelope.error.message,
    res.status,
    envelope.error.details,
  );
}

/** `null` when the body is not an `ApiResult` — including when it is not JSON. */
function parseEnvelope<T>(body: string): ApiResult<T> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { ok?: unknown; data?: unknown; error?: unknown };
  if (candidate.ok === true) return { ok: true, data: candidate.data as T };
  if (candidate.ok === false && typeof candidate.error === 'object' && candidate.error !== null) {
    return { ok: false, error: candidate.error as ApiError };
  }
  return null;
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function trimEnd(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function trimStart(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}
