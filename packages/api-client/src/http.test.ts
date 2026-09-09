import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { PlanPalApiError } from './errors';
import { createHttp, type HttpOptions } from './http';

/**
 * The transport, against a stubbed `fetch`.
 *
 * What these tests prove: the client's own logic. What they do NOT prove:
 * anything about the gateway. Kong answers an expired or malformed JWT itself,
 * with its own body shape, before our handler runs — so the 401 this client
 * actually meets in production is not the one `openapi.yaml` describes. That
 * half is proved against the running stack in B6's integration spec. Treat the
 * route/behaviour claims here as verified against a stub only.
 */

const BASE_URL = 'http://127.0.0.1:54321/functions/v1';
const ANON_KEY = 'anon-key-for-tests';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function rawResponse(status: number, body: string, contentType: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } });
}

type TokenSpy = Mock<() => Promise<string | null>>;

/**
 * A client whose token source and refresh are spies, so calls can be counted.
 *
 * The spies returned are the ones the client actually holds, including when a
 * test overrides them — returning the defaults instead would make an override
 * silently untested, and did once while this file was being written.
 */
function makeClient(overrides: Partial<HttpOptions> = {}) {
  const getAccessToken = (overrides.getAccessToken ??
    vi.fn<() => Promise<string | null>>().mockResolvedValue('access-1')) as TokenSpy;
  const refresh = (overrides.refresh ??
    vi.fn<() => Promise<string | null>>().mockResolvedValue('access-2')) as TokenSpy;
  const http = createHttp({
    baseUrl: overrides.baseUrl ?? BASE_URL,
    anonKey: overrides.anonKey ?? ANON_KEY,
    getAccessToken,
    refresh,
  });
  return { http, getAccessToken, refresh };
}

function fetchMock() {
  return vi.mocked(globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createHttp', () => {
  it('attaches the bearer token and the apikey header', async () => {
    const { http } = makeClient();
    fetchMock().mockResolvedValue(jsonResponse(200, { ok: true, data: { items: [] } }));

    await http.json('events');

    const [url, init] = fetchMock().mock.calls[0] as [URL | string, RequestInit];
    expect(String(url)).toBe(`${BASE_URL}/events`);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-1');
    expect(headers.apikey).toBe(ANON_KEY);
  });

  it('unwraps ok:true envelopes to data', async () => {
    const { http } = makeClient();
    fetchMock().mockResolvedValue(
      jsonResponse(200, { ok: true, data: { id: 'e1', title: 'Gym' } }),
    );

    await expect(http.json('events/e1')).resolves.toEqual({ id: 'e1', title: 'Gym' });
  });

  it('maps ok:false to PlanPalApiError with the contract code', async () => {
    const { http } = makeClient();
    fetchMock().mockResolvedValue(
      jsonResponse(400, {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'One or more fields are invalid.',
          details: { localEnd: ['must be after localStart'] },
        },
      }),
    );

    const error = await http.json('events', { method: 'POST', body: {} }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    const apiError = error as PlanPalApiError;
    expect(apiError.code).toBe('VALIDATION_ERROR');
    expect(apiError.status).toBe(400);
    expect(apiError.message).toBe('One or more fields are invalid.');
    expect(apiError.details).toEqual({ localEnd: ['must be after localStart'] });
  });

  it('refreshes once and retries once on a 401, then succeeds', async () => {
    const { http, refresh } = makeClient();
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(401, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Expired.' } }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, data: { items: [], nextCursor: null } }),
      );

    await expect(http.json('events')).resolves.toEqual({ items: [], nextCursor: null });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    // The retry must carry the NEW token, or the refresh was pointless.
    const [, retryInit] = fetchMock().mock.calls[1] as [URL | string, RequestInit];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer access-2');
  });

  it('refreshes on a 401 whose body is not an ApiResult envelope', async () => {
    const { http, refresh } = makeClient();
    // Kong's own body for a malformed JWT — no `ok`, no `error`. A client that
    // reads body.ok before deciding to refresh throws here instead of refreshing.
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse(401, {
          code: 'UNAUTHORIZED_INVALID_JWT_FORMAT',
          message: 'Invalid JWT format',
          msg: 'Invalid JWT format',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, data: { items: [], nextCursor: null } }),
      );

    await expect(http.json('events')).resolves.toEqual({ items: [], nextCursor: null });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('throws UNAUTHENTICATED and does not loop when the retry also 401s', async () => {
    const { http, refresh } = makeClient();
    // `mockImplementation`, not `mockResolvedValue`: this is the one test where
    // fetch is called twice, and a `Response` body can only be read once, so a
    // single shared Response would throw `Body is unusable` on the retry —
    // which is a fault in the fixture, not in the client.
    fetchMock().mockImplementation(() =>
      Promise.resolve(
        jsonResponse(401, {
          code: 'UNAUTHORIZED_INVALID_JWT_FORMAT',
          message: 'Invalid JWT format',
        }),
      ),
    );

    const error = await http.json('events').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).code).toBe('UNAUTHENTICATED');
    expect((error as PlanPalApiError).status).toBe(401);
    expect(refresh).toHaveBeenCalledTimes(1);
    // Exactly two: the original and one retry. Three would mean a loop, and a
    // loop against a dead refresh token is a client that hammers the gateway.
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it('maps a non-JSON 5xx body to PlanPalApiError without JSON.parse throwing', async () => {
    const { http } = makeClient();
    fetchMock().mockResolvedValue(
      rawResponse(502, '<html><body>Bad Gateway</body></html>', 'text/html'),
    );

    const error = await http.json('events').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).code).toBe('INTERNAL_ERROR');
    expect((error as PlanPalApiError).status).toBe(502);
    // Not a SyntaxError from a blind JSON.parse.
    expect((error as PlanPalApiError).name).toBe('PlanPalApiError');
  });

  it('does not retry when the session cannot be renewed', async () => {
    // refresh() resolving null means there is no new credential to send, so a
    // second round-trip would ask the same question and get the same answer.
    const { http, refresh } = makeClient({ refresh: vi.fn().mockResolvedValue(null) });
    fetchMock().mockResolvedValue(
      jsonResponse(401, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Expired.' } }),
    );

    const error = await http.json('events').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).code).toBe('UNAUTHENTICATED');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('maps each gateway status to the contract code an app can switch on', async () => {
    // The gateway's own code strings ("UNAUTHORIZED_NO_AUTH_HEADER", ...) are
    // not in `ApiErrorCode` and must never reach app code, so the status is
    // what the code is synthesised from. App code switches on these.
    const cases: ReadonlyArray<readonly [number, string]> = [
      [400, 'VALIDATION_ERROR'],
      [403, 'FORBIDDEN'],
      [404, 'NOT_FOUND'],
      [405, 'METHOD_NOT_ALLOWED'],
      [409, 'CONFLICT'],
      [422, 'VALIDATION_ERROR'],
      [429, 'RATE_LIMITED'],
      [500, 'INTERNAL_ERROR'],
    ];

    for (const [status, expected] of cases) {
      const { http } = makeClient();
      fetchMock().mockImplementation(() =>
        Promise.resolve(rawResponse(status, 'not an envelope', 'text/plain')),
      );

      const error = await http.json('events').catch((e: unknown) => e);

      expect(error, `status ${status}`).toBeInstanceOf(PlanPalApiError);
      expect((error as PlanPalApiError).code, `status ${status}`).toBe(expected);
      expect((error as PlanPalApiError).status, `status ${status}`).toBe(status);
    }
  });

  it('keeps an empty body diagnosable rather than silently mapping it', async () => {
    const { http } = makeClient();
    fetchMock().mockResolvedValue(rawResponse(504, '', 'text/plain'));

    const error = await http.json('events').catch((e: unknown) => e);

    expect((error as PlanPalApiError).message).toContain('HTTP 504');
    expect((error as PlanPalApiError).message).toContain('empty body');
  });

  it('throws from empty() on an error envelope rather than resolving', async () => {
    // `DELETE /events/{id}` resolves to void on 202, so a caller has nothing to
    // inspect — if this swallowed a 409 the deletion would appear to succeed.
    const { http } = makeClient();
    fetchMock().mockResolvedValue(
      jsonResponse(409, {
        ok: false,
        error: { code: 'CONFLICT', message: 'That username is already taken.' },
      }),
    );

    const error = await http.empty('me/devices/tok', { method: 'DELETE' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).code).toBe('CONFLICT');
  });

  it('throws from text() rather than returning an error body as content', async () => {
    // Otherwise `export.ical()` hands the caller an error page to write to a
    // .ics file, and the failure surfaces in a calendar app instead of here.
    const { http } = makeClient();
    fetchMock().mockResolvedValue(rawResponse(503, 'upstream unavailable', 'text/plain'));

    const error = await http.text('export/ical').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).status).toBe(503);
  });

  it('sends query parameters and does not double the slash between base and path', async () => {
    const { http } = makeClient({ baseUrl: `${BASE_URL}/` });
    fetchMock().mockResolvedValue(jsonResponse(200, { ok: true, data: [] }));

    await http.json('/occurrences', { query: { from: '2026-09-01', to: '2026-09-30' } });

    const [url] = fetchMock().mock.calls[0] as [URL | string];
    expect(String(url)).toBe(`${BASE_URL}/occurrences?from=2026-09-01&to=2026-09-30`);
  });

  it('omits the Authorization header entirely when there is no session', async () => {
    // /healthz is `security: []`. Sending `Bearer null` would be worse than
    // sending nothing: the gateway rejects a malformed token.
    const { http } = makeClient({ getAccessToken: vi.fn().mockResolvedValue(null) });
    fetchMock().mockResolvedValue(jsonResponse(200, { ok: true, data: { status: 'ok' } }));

    await http.json('healthz');

    const [, init] = fetchMock().mock.calls[0] as [URL | string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.apikey).toBe(ANON_KEY);
  });

  it('returns text/calendar bodies as a string', async () => {
    const { http } = makeClient();
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    fetchMock().mockResolvedValue(rawResponse(200, ics, 'text/calendar; charset=utf-8'));

    const body = await http.text('export/ical');

    expect(typeof body).toBe('string');
    expect(body).toBe(ics);
  });
});
