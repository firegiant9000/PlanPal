import type { EventOccurrence } from '@planpal/types';

/**
 * AD-10 — the offline cache is keyed by month, behind the client.
 *
 * One interface, an implementation per platform: an in-memory default here
 * (M3), and an `AsyncStorage` adapter in T29. AD-9 bans **tokens** from
 * `AsyncStorage` because it is unencrypted; calendar data is a different
 * judgement, and it is a deliberate one — see `adapters/asyncStorage.ts` when
 * it lands.
 */
export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  /** No prefix clears everything. */
  clear(prefix?: string): Promise<void>;
}

/**
 * What a month is stored as, under `occ:<userId>:<yyyy-mm>`. The envelope, not
 * the bare array.
 *
 * `fetchedAt` is why: T29 renders "last updated ..." from it, and a cache that
 * stored only the array would have to be emptied to add it later.
 */
export interface CachedMonth {
  /** ISO 8601, stamped by `writeMonth` — never by the caller. */
  fetchedAt: string;
  items: EventOccurrence[];
}

/** Thrown by a `cache-only` read with nothing stored for that month. */
export class CacheMissError extends Error {
  override readonly name = 'CacheMissError';
  constructor(readonly key: string) {
    super(`No cached data for ${key}, and the read policy forbids the network.`);
  }
}

/** Cleared wholesale on sign-out: a shared device must not show the previous
 * user's calendar. */
export const OCCURRENCE_CACHE_PREFIX = 'occ:';

export function occurrenceCacheKey(userId: string, month: string): string {
  return `${OCCURRENCE_CACHE_PREFIX}${userId}:${month}`;
}

/** Every month belonging to one user — the invalidation unit for a write. */
export function userMonthPrefix(userId: string): string {
  return `${OCCURRENCE_CACHE_PREFIX}${userId}:`;
}

/**
 * Read one cached month.
 *
 * Returns null for a miss and for a stored value that is not an envelope —
 * a cache written by an older build, or a partial write. Treating that as a
 * miss costs one fetch; trusting it would hand the caller `undefined` items.
 */
export async function readMonth(
  cache: CacheAdapter,
  userId: string,
  month: string,
): Promise<CachedMonth | null> {
  const stored = await cache.get<CachedMonth>(occurrenceCacheKey(userId, month));
  if (!stored || !Array.isArray(stored.items) || typeof stored.fetchedAt !== 'string') {
    return null;
  }
  return stored;
}

/**
 * Write one month, stamping `fetchedAt` here.
 *
 * The stamp belongs to the cache, not the caller: a caller that assembled its
 * own envelope could write a stale or absent timestamp, and T29's freshness
 * display would be quietly wrong rather than obviously broken.
 */
export async function writeMonth(
  cache: CacheAdapter,
  userId: string,
  month: string,
  items: EventOccurrence[],
  now: () => Date,
  ttlMs?: number,
): Promise<CachedMonth> {
  const envelope: CachedMonth = { fetchedAt: now().toISOString(), items };
  await cache.set(occurrenceCacheKey(userId, month), envelope, ttlMs);
  return envelope;
}

interface MemoryEntry {
  value: unknown;
  expiresAt: number | null;
}

/**
 * The M3 default: in-memory, per client instance.
 *
 * Enough to make the seam real and testable. It does not survive a cold start,
 * which is exactly what T29's `AsyncStorage` adapter adds — and why the
 * interface exists now rather than being invented then.
 */
export function createMemoryCache(): CacheAdapter {
  const entries = new Map<string, MemoryEntry>();

  return {
    get<T>(key: string): Promise<T | null> {
      const entry = entries.get(key);
      if (!entry) return Promise.resolve(null);
      if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(entry.value as T);
    },

    set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
      entries.set(key, {
        value,
        expiresAt: ttlMs === undefined ? null : Date.now() + ttlMs,
      });
      return Promise.resolve();
    },

    clear(prefix?: string): Promise<void> {
      if (prefix === undefined) {
        entries.clear();
        return Promise.resolve();
      }
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
      return Promise.resolve();
    },
  };
}
