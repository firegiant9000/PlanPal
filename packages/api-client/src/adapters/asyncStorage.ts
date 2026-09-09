import type { CacheAdapter } from '../cache';

/**
 * A `CacheAdapter` over React Native's `AsyncStorage`, for offline reads (T29,
 * AD-10).
 *
 * THIS IS NOT AN AD-9 VIOLATION, though it looks like one at a glance. AD-9
 * bans **session tokens** from `AsyncStorage` because it is unencrypted; those
 * go to `expo-secure-store` via `SessionStore`. Calendar occurrences are a
 * different key space and a different risk: they are the user's own data,
 * already on the device's screen, and losing them costs a refetch. Nothing in
 * this file may ever store a token.
 *
 * The storage object is INJECTED rather than imported. `@planpal/api-client` is
 * consumed by the web app too, where `@react-native-async-storage/async-storage`
 * does not exist and would break the Next build — and injecting it is also what
 * makes this testable without a device.
 */

/** The subset of AsyncStorage's API this adapter uses. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export function createAsyncStorageCache(storage: AsyncStorageLike): CacheAdapter {
  return {
    async get<T>(key: string): Promise<T | null> {
      const raw = await storage.getItem(key);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        // A write killed halfway leaves truncated JSON. Treating that as a
        // miss costs one refetch; throwing would crash the calendar on every
        // launch with no route out but reinstalling the app.
        return null;
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      // `ttlMs` is accepted by the interface and ignored here: AsyncStorage has
      // no expiry, and the freshness the UI needs is `CachedMonth.fetchedAt`,
      // which the cache layer stamps. A silent TTL would be worse than none.
      await storage.setItem(key, JSON.stringify(value));
    },

    async clear(prefix?: string): Promise<void> {
      const keys = await storage.getAllKeys();
      const doomed = prefix === undefined ? keys : keys.filter((k) => k.startsWith(prefix));
      if (doomed.length > 0) await storage.multiRemove(doomed);
    },
  };
}
