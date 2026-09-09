import { loadOccurrences, type OccurrencesLike } from './loadOccurrences';

const WINDOW = { from: '2026-08-30', to: '2026-10-10' };

const CACHED = [
  {
    eventId: 'e1',
    occurrenceDate: '2026-09-07',
    title: 'From cache',
    localStart: '2026-09-07T09:00:00',
    localEnd: '2026-09-07T09:30:00',
    timezoneId: 'America/New_York',
    visibility: 'private',
    isException: false,
    isVariableSchedule: false,
  },
];

const FRESH = [{ ...CACHED[0]!, title: 'From network' }];

/** Fake resource that answers per policy, so each test states only its case. */
function resource(handlers: {
  cache?: () => Promise<{ items: unknown[]; fetchedAt: string | null }>;
  network?: () => Promise<{ items: unknown[]; fetchedAt: string | null }>;
}): OccurrencesLike {
  return {
    rangeDetailed: (_from, _to, opts) => {
      const policy = opts?.policy;
      const handler = policy === 'cache-only' ? handlers.cache : handlers.network;
      if (!handler) return Promise.reject(new Error(`no handler for ${String(policy)}`));
      return handler() as ReturnType<OccurrencesLike['rangeDetailed']>;
    },
  };
}

function networkError(): Error {
  // What `fetch` throws with no connectivity: no response, so no status.
  return new TypeError('Network request failed');
}

function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('loadOccurrences', () => {
  it('paints the cache first, then replaces it with the network result', async () => {
    const painted: string[][] = [];
    const result = await loadOccurrences(
      resource({
        cache: () => Promise.resolve({ items: CACHED, fetchedAt: '2026-09-08T10:00:00.000Z' }),
        network: () => Promise.resolve({ items: FRESH, fetchedAt: '2026-09-08T12:00:00.000Z' }),
      }),
      WINDOW,
      (partial) => painted.push(partial.items.map((i) => i.title)),
    );

    // The early paint is what makes a warm start instant rather than a spinner.
    expect(painted).toEqual([['From cache']]);
    expect(result.items.map((i) => i.title)).toEqual(['From network']);
    expect(result.offline).toBe(false);
    expect(result.failure).toBeNull();
  });

  it('refreshes a month that is already cached', async () => {
    // The regression this exists for: `cache-first` returns a stored month and
    // never revalidates, so an event created on web would never reach the
    // phone. The network call must happen even on a cache hit.
    let networkCalls = 0;
    const result = await loadOccurrences(
      resource({
        cache: () => Promise.resolve({ items: CACHED, fetchedAt: '2026-09-08T10:00:00.000Z' }),
        network: () => {
          networkCalls += 1;
          return Promise.resolve({ items: FRESH, fetchedAt: '2026-09-08T12:00:00.000Z' });
        },
      }),
      WINDOW,
    );

    expect(networkCalls).toBe(1);
    expect(result.items.map((i) => i.title)).toEqual(['From network']);
  });

  it('reports offline while still returning the cached calendar', async () => {
    // The other half of the regression: a cache hit used to resolve, so the
    // screen concluded it was online, hid the banner, and let edits through.
    const result = await loadOccurrences(
      resource({
        cache: () => Promise.resolve({ items: CACHED, fetchedAt: '2026-09-08T10:00:00.000Z' }),
        network: () => Promise.reject(networkError()),
      }),
      WINDOW,
    );

    expect(result.offline).toBe(true);
    expect(result.items.map((i) => i.title)).toEqual(['From cache']);
    expect(result.fetchedAt).toBe('2026-09-08T10:00:00.000Z');
    // Not a failure state: there is a calendar to show, just a stale one.
    expect(result.failure).toBeNull();
  });

  it('reports a failure when there is nothing cached to fall back on', async () => {
    const result = await loadOccurrences(
      resource({
        cache: () => Promise.reject(new Error('cache miss')),
        network: () => Promise.reject(networkError()),
      }),
      WINDOW,
    );

    expect(result.offline).toBe(true);
    expect(result.failure).toBe('offline');
    expect(result.items).toEqual([]);
  });

  it('distinguishes an expired session from being offline', async () => {
    for (const status of [401, 403]) {
      const result = await loadOccurrences(
        resource({
          cache: () => Promise.reject(new Error('cache miss')),
          network: () => Promise.reject(apiError(status)),
        }),
        WINDOW,
      );
      expect(result.failure).toBe('forbidden');
      // A 403 is the server answering, so the device is demonstrably online.
      expect(result.offline).toBe(false);
    }
  });

  it('treats a server error as failed rather than offline', async () => {
    const result = await loadOccurrences(
      resource({
        cache: () => Promise.reject(new Error('cache miss')),
        network: () => Promise.reject(apiError(500)),
      }),
      WINDOW,
    );
    expect(result.failure).toBe('failed');
    expect(result.offline).toBe(false);
  });
});
