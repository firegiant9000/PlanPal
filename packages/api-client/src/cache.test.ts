import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CacheMissError,
  createMemoryCache,
  occurrenceCacheKey,
  type CacheAdapter,
  type CachedMonth,
} from './cache';
import { createPlanPalClient, type PlanPalClient } from './client';

/**
 * The month-keyed cache seam (AD-10).
 *
 * `GET /occurrences` takes an arbitrary `(from,to)`, so caching that verbatim
 * gives a cache that never hits twice. Months are the unit instead, behind the
 * client, so neither app has to know.
 *
 * The stored shape is an envelope rather than a bare array. That is not
 * decoration: T29's "last updated ..." has nowhere to come from otherwise, and
 * retrofitting it later would mean invalidating every entry written before the
 * change.
 */

const USER_ID = '99999999-9999-9999-9999-999999999999';
const OTHER_USER_ID = '11111111-1111-1111-1111-111111111111';
const FETCHED_AT = '2026-09-08T02:00:00.000Z';

const gotrue = vi.hoisted(() => ({
  getSession: vi.fn(),
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

function stubOccurrences(items: unknown[]) {
  fetchMock().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true, data: items }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

function occurrence(date: string) {
  return { eventId: 'e1', occurrenceDate: date, title: 'Gym' };
}

let cache: CacheAdapter;
let client: PlanPalClient;

function build(userId: string = USER_ID): PlanPalClient {
  gotrue.getSession.mockImplementation(() =>
    Promise.resolve({ data: { session: { access_token: 'access-1', user: { id: userId } } } }),
  );
  return createPlanPalClient({
    supabaseUrl: 'http://127.0.0.1:54321',
    anonKey: 'anon-key-for-tests',
    cache,
    // Injected so `fetchedAt` is assertable rather than "some ISO string".
    now: () => new Date(FETCHED_AT),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  cache = createMemoryCache();
  client = build();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('the month cache', () => {
  it('keys a month as occ:<userId>:<yyyy-mm>', async () => {
    stubOccurrences([occurrence('2026-09-10')]);

    await client.occurrences.range('2026-09-01', '2026-09-30');

    const stored = await cache.get<CachedMonth>(`occ:${USER_ID}:2026-09`);
    expect(stored).not.toBeNull();
    expect(occurrenceCacheKey(USER_ID, '2026-09')).toBe(`occ:${USER_ID}:2026-09`);
  });

  it('stores a fetchedAt envelope, not the bare array', async () => {
    stubOccurrences([occurrence('2026-09-10')]);

    await client.occurrences.range('2026-09-01', '2026-09-30');

    const stored = await cache.get<CachedMonth>(`occ:${USER_ID}:2026-09`);
    expect(Array.isArray(stored)).toBe(false);
    expect(stored?.fetchedAt).toBe(FETCHED_AT);
    expect(stored?.items).toEqual([occurrence('2026-09-10')]);
  });

  it('cache-first serves a stored month without calling fetch', async () => {
    stubOccurrences([occurrence('2026-09-10')]);
    await client.occurrences.range('2026-09-01', '2026-09-30');
    expect(fetchMock()).toHaveBeenCalledTimes(1);

    const items = await client.occurrences.range('2026-09-01', '2026-09-30', {
      policy: 'cache-first',
    });

    expect(items).toEqual([occurrence('2026-09-10')]);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('cache-only throws rather than calling fetch when a month is missing', async () => {
    stubOccurrences([occurrence('2026-09-10')]);

    const error = await client.occurrences
      .range('2026-09-01', '2026-09-30', { policy: 'cache-only' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CacheMissError);
    // The point of cache-only is that it cannot reach the network — an offline
    // read that quietly hangs on a dead socket is worse than one that fails.
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('network-first refetches and overwrites the stored month', async () => {
    stubOccurrences([occurrence('2026-09-10')]);
    await client.occurrences.range('2026-09-01', '2026-09-30');

    stubOccurrences([occurrence('2026-09-10'), occurrence('2026-09-17')]);
    const items = await client.occurrences.range('2026-09-01', '2026-09-30', {
      policy: 'network-first',
    });

    expect(items).toHaveLength(2);
    expect(fetchMock()).toHaveBeenCalledTimes(2);
    const stored = await cache.get<CachedMonth>(`occ:${USER_ID}:2026-09`);
    expect(stored?.items).toHaveLength(2);
  });

  it('clears every month for the user after events.create', async () => {
    stubOccurrences([occurrence('2026-09-10')]);
    await client.occurrences.range('2026-08-01', '2026-10-31');
    expect(await cache.get<CachedMonth>(`occ:${USER_ID}:2026-08`)).not.toBeNull();
    expect(await cache.get<CachedMonth>(`occ:${USER_ID}:2026-10`)).not.toBeNull();

    fetchMock().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { id: 'e1' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await client.events.create({ title: 'Weekly standup' } as never);

    // Every month, not just the one the event starts in: a recurring master
    // can generate occurrences in any month, and working out which would mean
    // expanding the rule in the client (AD-1 says no).
    expect(await cache.get<CachedMonth>(`occ:${USER_ID}:2026-08`)).toBeNull();
    expect(await cache.get<CachedMonth>(`occ:${USER_ID}:2026-09`)).toBeNull();
    expect(await cache.get<CachedMonth>(`occ:${USER_ID}:2026-10`)).toBeNull();
  });

  it("leaves another user's months alone when this user writes", async () => {
    // Scoped to the user, not the whole `occ:` prefix. On a shared handset,
    // one account creating an event must not cold-start the other's calendar.
    await cache.set(occurrenceCacheKey(OTHER_USER_ID, '2026-09'), {
      fetchedAt: FETCHED_AT,
      items: [],
    });
    fetchMock().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { id: 'e1' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await client.events.create({ title: 'Weekly standup' } as never);

    expect(await cache.get(occurrenceCacheKey(OTHER_USER_ID, '2026-09'))).not.toBeNull();
  });

  it("clears every user's months on signOut", async () => {
    // Two users' months in one store, as happens on a shared handset.
    await cache.set(occurrenceCacheKey(USER_ID, '2026-09'), { fetchedAt: FETCHED_AT, items: [] });
    await cache.set(occurrenceCacheKey(OTHER_USER_ID, '2026-09'), {
      fetchedAt: FETCHED_AT,
      items: [],
    });

    await client.auth.signOut();

    expect(await cache.get(occurrenceCacheKey(USER_ID, '2026-09'))).toBeNull();
    expect(await cache.get(occurrenceCacheKey(OTHER_USER_ID, '2026-09'))).toBeNull();
  });
});

describe('freshness, for T29', () => {
  it('reports the oldest fetchedAt across the months it served', async () => {
    stubOccurrences([occurrence('2026-09-10')]);

    const detailed = await client.occurrences.rangeDetailed('2026-09-01', '2026-09-30');

    expect(detailed.items).toEqual([occurrence('2026-09-10')]);
    expect(detailed.fetchedAt).toBe(FETCHED_AT);
  });
});

describe('createMemoryCache', () => {
  it('clears only the given prefix, leaving other keys intact', async () => {
    const memory = createMemoryCache();
    await memory.set('occ:u1:2026-09', 1);
    await memory.set('other:key', 2);

    await memory.clear('occ:');

    expect(await memory.get('occ:u1:2026-09')).toBeNull();
    expect(await memory.get('other:key')).toBe(2);
  });

  it('expires a value once its ttl has passed', async () => {
    vi.useFakeTimers();
    try {
      const memory = createMemoryCache();
      await memory.set('k', 'v', 1000);
      expect(await memory.get('k')).toBe('v');

      vi.advanceTimersByTime(1001);

      expect(await memory.get('k')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
