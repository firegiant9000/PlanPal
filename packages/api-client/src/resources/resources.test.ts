import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanPalApiError } from '../errors';
import { createPlanPalClient, type PlanPalClient } from '../client';

/**
 * The route table, against a stubbed `fetch`.
 *
 * Option 1 (a hand-rolled client) buys exact control of the refresh path and
 * gives up compile-time checking of route paths. This file is what replaces
 * that: every method's URL and verb is asserted against the contract. A wrong
 * segment fails here rather than at runtime on a phone.
 *
 * It is still only a stub. B6 exercises `events.list()` against the running
 * stack; until then every route claim here is verified against a fake.
 */

const BASE_URL = 'http://127.0.0.1:54321/functions/v1';
const ANON_KEY = 'anon-key-for-tests';

const gotrue = vi.hoisted(() => ({
  getSession: vi.fn(() => Promise.resolve({ data: { session: { access_token: 'access-1' } } })),
  refreshSession: vi.fn(() =>
    Promise.resolve({ data: { session: { access_token: 'access-2' } }, error: null }),
  ),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: gotrue })),
}));

function fetchMock() {
  return vi.mocked(globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
}

/** Every call gets a fresh Response — a body can only be read once. */
function stubJson(data: unknown, status = 200) {
  fetchMock().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, data }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

function stubRaw(body: string, contentType: string, status = 200) {
  fetchMock().mockImplementation(() =>
    Promise.resolve(new Response(body, { status, headers: { 'Content-Type': contentType } })),
  );
}

function calledUrls(): string[] {
  return fetchMock().mock.calls.map((call) => String((call as unknown[])[0]));
}

function calledMethods(): string[] {
  return fetchMock().mock.calls.map(
    (call) => ((call as unknown[])[1] as RequestInit | undefined)?.method ?? 'GET',
  );
}

const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const OCCURRENCE_DATE = '2026-09-14';
const PUSH_TOKEN = 'ExponentPushToken[abc-123]';

let client: PlanPalClient;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  client = createPlanPalClient({
    supabaseUrl: 'http://127.0.0.1:54321',
    baseUrl: BASE_URL,
    anonKey: ANON_KEY,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/**
 * Every route the client speaks, with the verb and path the contract declares.
 * The plan's fourteen rows, expanded to one entry per HTTP route.
 */
const ROUTES: ReadonlyArray<{
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly data: unknown;
  readonly call: (c: PlanPalClient) => Promise<unknown>;
}> = [
  {
    name: 'events.list',
    method: 'GET',
    path: '/events?limit=50',
    data: { items: [], nextCursor: null },
    call: (c) => c.events.list({ limit: 50 }),
  },
  {
    name: 'events.create',
    method: 'POST',
    path: '/events',
    data: { id: EVENT_ID },
    call: (c) => c.events.create({ title: 'Gym' } as never),
  },
  {
    name: 'events.get',
    method: 'GET',
    path: `/events/${EVENT_ID}`,
    data: { id: EVENT_ID },
    call: (c) => c.events.get(EVENT_ID),
  },
  {
    name: 'events.update',
    method: 'PATCH',
    path: `/events/${EVENT_ID}`,
    data: { id: EVENT_ID },
    call: (c) => c.events.update(EVENT_ID, { title: 'Gym II' } as never),
  },
  {
    name: 'events.remove',
    method: 'DELETE',
    path: `/events/${EVENT_ID}`,
    data: null,
    call: (c) => c.events.remove(EVENT_ID),
  },
  {
    name: 'events.overrideOccurrence',
    method: 'PATCH',
    path: `/events/${EVENT_ID}/occurrences/${OCCURRENCE_DATE}`,
    data: { eventId: EVENT_ID, occurrenceDate: OCCURRENCE_DATE },
    call: (c) =>
      c.events.overrideOccurrence(EVENT_ID, OCCURRENCE_DATE, {
        localStart: '2026-09-14T11:00:00',
      } as never),
  },
  {
    name: 'events.cancelOccurrence',
    method: 'DELETE',
    path: `/events/${EVENT_ID}/occurrences/${OCCURRENCE_DATE}`,
    data: null,
    call: (c) => c.events.cancelOccurrence(EVENT_ID, OCCURRENCE_DATE),
  },
  {
    name: 'occurrences.range',
    method: 'GET',
    path: '/occurrences?from=2026-09-01&to=2026-09-30',
    // `{ items }`, not a bare array — the handler ends in `ok({ items })`.
    data: { items: [] },
    call: (c) => c.occurrences.range('2026-09-01', '2026-09-30'),
  },
  { name: 'profile.get', method: 'GET', path: '/me', data: {}, call: (c) => c.profile.get() },
  {
    name: 'profile.update',
    method: 'PATCH',
    path: '/me',
    data: {},
    call: (c) => c.profile.update({ displayName: 'Arlo' } as never),
  },
  {
    name: 'profile.remove',
    method: 'DELETE',
    path: '/me',
    data: null,
    call: (c) => c.profile.remove(),
  },
  {
    name: 'notificationPreferences.get',
    method: 'GET',
    path: '/me/notification-preferences',
    data: {},
    call: (c) => c.notificationPreferences.get(),
  },
  {
    name: 'notificationPreferences.update',
    method: 'PUT',
    path: '/me/notification-preferences',
    data: {},
    call: (c) => c.notificationPreferences.update({ leadTimeMinutes: 15 } as never),
  },
  {
    name: 'devices.register',
    method: 'POST',
    path: '/me/devices',
    data: { expoPushToken: PUSH_TOKEN, platform: 'android' },
    call: (c) => c.devices.register(PUSH_TOKEN, 'android'),
  },
  {
    name: 'devices.unregister',
    method: 'DELETE',
    path: `/me/devices/${encodeURIComponent(PUSH_TOKEN)}`,
    data: null,
    call: (c) => c.devices.unregister(PUSH_TOKEN),
  },
  {
    name: 'friendCode.get',
    method: 'GET',
    path: '/friend-code',
    data: {},
    call: (c) => c.friendCode.get(),
  },
  {
    name: 'friendCode.rotate',
    method: 'POST',
    path: '/friend-code/rotate',
    data: {},
    call: (c) => c.friendCode.rotate(),
  },
  {
    name: 'health',
    method: 'GET',
    path: '/healthz',
    data: { status: 'ok', version: 'abc' },
    call: (c) => c.health(),
  },
];

describe('the route table', () => {
  it('sends each route at the path and method the contract declares', async () => {
    for (const route of ROUTES) {
      fetchMock().mockClear();
      stubJson(route.data, route.method === 'DELETE' ? 202 : 200);

      await route.call(client);

      expect(calledUrls(), route.name).toEqual([`${BASE_URL}${route.path}`]);
      expect(calledMethods(), route.name).toEqual([route.method]);
    }
  });

  it('sends export.ical at GET /export/ical', async () => {
    // Separate from the table: it is the one route whose body is not JSON, so
    // it needs a text/calendar stub rather than an envelope.
    stubRaw('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'text/calendar');

    await client.export.ical();

    expect(calledUrls()).toEqual([`${BASE_URL}/export/ical`]);
    expect(calledMethods()).toEqual(['GET']);
  });
});

describe('the four corrections to §5', () => {
  it('returns the registered Device from devices.register', async () => {
    // §5 typed this `void`, which throws away the row the server assigned —
    // including `lastSeenAt`, and including the fact that it succeeded at all.
    stubJson({
      expoPushToken: PUSH_TOKEN,
      platform: 'android',
      lastSeenAt: '2026-09-08T00:00:00Z',
    });

    await expect(client.devices.register(PUSH_TOKEN, 'android')).resolves.toEqual({
      expoPushToken: PUSH_TOKEN,
      platform: 'android',
      lastSeenAt: '2026-09-08T00:00:00Z',
    });
  });

  it('surfaces a 409 from devices.register as PlanPalApiError with code CONFLICT', async () => {
    // A token already bound to another account. The caller has to be able to
    // see this: silently swallowing it leaves the phone registered to the
    // previous user and reminders going to the wrong person.
    fetchMock().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ok: false,
            error: { code: 'CONFLICT', message: 'That device is registered to another account.' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const error = await client.devices.register(PUSH_TOKEN, 'android').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PlanPalApiError);
    expect((error as PlanPalApiError).code).toBe('CONFLICT');
    expect((error as PlanPalApiError).status).toBe(409);
  });

  it('returns export.ical as a string, not a Blob', async () => {
    // React Native's fetch has partial Blob support, so a Blob here works on
    // web and fails on a phone.
    const ics = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
    stubRaw(ics, 'text/calendar; charset=utf-8');

    const body = await client.export.ical();

    expect(typeof body).toBe('string');
    expect(body).toBe(ics);
  });

  it('exposes health() so an offline indicator has something to ask', async () => {
    stubJson({ status: 'ok', version: 'c6dd6c2' });

    await expect(client.health()).resolves.toEqual({ status: 'ok', version: 'c6dd6c2' });
  });
});

describe('occurrences.range windowing (AD-10)', () => {
  it('rejects an occurrences range longer than 180 days by chunking, never by sending it', async () => {
    // MAX_RANGE_DAYS = 180 and the endpoint 400s above it, so a year-wide
    // swipe has to be split by the client rather than discovered at runtime.
    stubJson({ items: [] });

    await client.occurrences.range('2026-01-15', '2026-12-20');

    const urls = calledUrls();
    expect(urls.length).toBe(12);
    for (const url of urls) {
      const params = new URL(url).searchParams;
      const from = new Date(`${params.get('from')}T00:00:00Z`).getTime();
      const to = new Date(`${params.get('to')}T00:00:00Z`).getTime();
      const days = (to - from) / 86_400_000;
      expect(days, url).toBeLessThanOrEqual(180);
    }
  });

  it('normalises (2026-01-15, 2026-03-02) to three whole months and returns only in-range items', async () => {
    fetchMock().mockImplementation((input: unknown) => {
      const month = new URL(String(input)).searchParams.get('from')?.slice(0, 7);
      // One occurrence on the 5th and one on the 20th of each month, so the
      // clipping is observable at both ends.
      const items = [
        { eventId: 'e1', occurrenceDate: `${month}-05` },
        { eventId: 'e1', occurrenceDate: `${month}-20` },
      ];
      return Promise.resolve(
        // `{ items }`, matching `ok({ items })` in the handler. A bare array
        // here is a shape the server never sends.
        new Response(JSON.stringify({ ok: true, data: { items } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const items = await client.occurrences.range('2026-01-15', '2026-03-02');

    expect(calledUrls().length).toBe(3);
    expect(items.map((i) => i.occurrenceDate)).toEqual(['2026-01-20', '2026-02-05', '2026-02-20']);
  });

  it('normalises a range that crosses a year boundary', async () => {
    // The off-by-one lives here: month 12 -> month 1 and year + 1.
    stubJson({ items: [] });

    await client.occurrences.range('2026-12-20', '2027-01-05');

    expect(calledUrls()).toEqual([
      `${BASE_URL}/occurrences?from=2026-12-01&to=2026-12-31`,
      `${BASE_URL}/occurrences?from=2027-01-01&to=2027-01-31`,
    ]);
  });

  it('asks for one month when from and to fall inside it', async () => {
    stubJson({ items: [] });

    await client.occurrences.range('2026-02-10', '2026-02-11');

    expect(calledUrls()).toEqual([`${BASE_URL}/occurrences?from=2026-02-01&to=2026-02-28`]);
  });

  it('ends February on the 29th in a leap year', async () => {
    stubJson({ items: [] });

    await client.occurrences.range('2028-02-10', '2028-02-11');

    expect(calledUrls()).toEqual([`${BASE_URL}/occurrences?from=2028-02-01&to=2028-02-29`]);
  });
});
