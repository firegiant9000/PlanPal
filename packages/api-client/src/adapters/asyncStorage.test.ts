import { describe, expect, it } from 'vitest';
import { createAsyncStorageCache, type AsyncStorageLike } from './asyncStorage';
import { OCCURRENCE_CACHE_PREFIX } from '../cache';

/** Minimal stand-in for `@react-native-async-storage/async-storage`. */
function fakeAsyncStorage(): AsyncStorageLike & { dump(): Record<string, string> } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => Promise.resolve(values.get(key) ?? null),
    setItem: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
    getAllKeys: () => Promise.resolve([...values.keys()]),
    multiRemove: (keys) => {
      for (const k of keys) values.delete(k);
      return Promise.resolve();
    },
    dump: () => Object.fromEntries(values),
  };
}

describe('createAsyncStorageCache', () => {
  it('round-trips a cached month envelope through a fake AsyncStorage', async () => {
    const storage = fakeAsyncStorage();
    const cache = createAsyncStorageCache(storage);
    const envelope = {
      fetchedAt: '2026-09-08T12:00:00.000Z',
      items: [{ eventId: 'e1', title: 'Standup' }],
    };

    await cache.set(`${OCCURRENCE_CACHE_PREFIX}user-1:2026-09`, envelope);

    // A new adapter over the same storage — a cold start reads what the
    // previous process wrote, which is the entire point of the offline cache.
    const afterRestart = createAsyncStorageCache(storage);
    await expect(afterRestart.get(`${OCCURRENCE_CACHE_PREFIX}user-1:2026-09`)).resolves.toEqual(
      envelope,
    );
  });

  it('resolves null for a key that was never written', async () => {
    const cache = createAsyncStorageCache(fakeAsyncStorage());
    await expect(cache.get('occ:user-1:1999-01')).resolves.toBeNull();
  });

  it('clears only the occ: prefix, leaving other keys intact', async () => {
    // The session lives in this same key space on some platforms. A `clear()`
    // that took everything would sign the user out on every cache invalidation.
    const storage = fakeAsyncStorage();
    const cache = createAsyncStorageCache(storage);

    await cache.set(`${OCCURRENCE_CACHE_PREFIX}user-1:2026-09`, { fetchedAt: 'x', items: [] });
    await cache.set(`${OCCURRENCE_CACHE_PREFIX}user-1:2026-10`, { fetchedAt: 'x', items: [] });
    await storage.setItem('planpal-auth-token', 'do-not-touch');

    await cache.clear(OCCURRENCE_CACHE_PREFIX);

    expect(Object.keys(storage.dump())).toEqual(['planpal-auth-token']);
  });

  it('clears everything when no prefix is given', async () => {
    const storage = fakeAsyncStorage();
    const cache = createAsyncStorageCache(storage);
    await cache.set('occ:a', { fetchedAt: 'x', items: [] });
    await cache.set('other:b', { fetchedAt: 'x', items: [] });

    await cache.clear();

    expect(Object.keys(storage.dump())).toEqual([]);
  });

  it('treats unparseable stored JSON as a miss rather than throwing', async () => {
    // A truncated write (killed mid-save) would otherwise crash the calendar on
    // every launch, with no way out but reinstalling.
    const storage = fakeAsyncStorage();
    await storage.setItem('occ:user-1:2026-09', '{"fetchedAt":');

    await expect(createAsyncStorageCache(storage).get('occ:user-1:2026-09')).resolves.toBeNull();
  });
});
