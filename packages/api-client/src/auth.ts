import {
  createClient,
  type Session,
  type SupabaseClient,
  type SupportedStorage,
} from '@supabase/supabase-js';

export type { Session };

/**
 * AD-9 — one interface, a storage implementation per platform. Web uses
 * supabase-js's default (localStorage); mobile uses `expo-secure-store`.
 *
 * Tokens never go in `AsyncStorage`: it is unencrypted and this is a refresh
 * token. Calendar data may (AD-10, T29) — that is a different key space and a
 * different risk.
 */
export interface SessionStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * The two ways a sign-up can succeed.
 *
 * With `[auth.email] enable_confirmations = true` (supabase/config.toml) a
 * successful sign-up returns no session until the emailed link is followed.
 * That is a success, not an error, so it arrives as a value — an earlier
 * version threw, which forced both sign-up screens to compare the message to
 * a literal to detect success.
 */
export type SignUpResult =
  | { status: 'signed-in'; session: Session }
  | { status: 'confirmation-required' };

export interface AuthClient {
  signInWithPassword(email: string, password: string): Promise<Session>;
  signUpWithPassword(email: string, password: string): Promise<SignUpResult>;
  /** Redirects; resolves once the redirect has been handed to the platform. */
  signInWithOAuth(provider: 'google' | 'apple'): Promise<void>;
  /**
   * Send a password-reset email.
   *
   * Resolves even when GoTrue rejects the address. That is deliberate: an
   * unregistered address must be indistinguishable from a registered one, or
   * the forgot-password form becomes an account-enumeration oracle.
   */
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  onAuthStateChange(cb: (s: Session | null) => void): () => void;
  /**
   * The storage adapter handed to supabase-js. Exposed so the chunking can be
   * tested directly: it is the part with a platform limit behind it, and
   * driving it through a real sign-in would need a live GoTrue.
   */
  storage: SupportedStorage;
  /** The access token, for `createHttp`'s `getAccessToken`. */
  getAccessToken(): Promise<string | null>;
  /** Force a refresh; resolves to the new access token, or null. */
  refresh(): Promise<string | null>;
}

/**
 * Only what `signOut` needs of the occurrence cache.
 *
 * Declared structurally rather than imported from `./cache` (B4) on purpose:
 * `cache.ts` will not import `auth.ts` either, so neither module depends on
 * the other and there is no cycle. `CacheAdapter` satisfies this shape.
 */
export interface ClearableCache {
  clear(prefix?: string): Promise<void>;
}

export interface AuthClientOptions {
  supabaseUrl: string;
  anonKey: string;
  /** Omit to use supabase-js's platform default (web: localStorage, AD-9). */
  store?: SessionStore;
  cache?: ClearableCache;
  /** Where an OAuth provider sends the user back. */
  redirectTo?: string;
}

/**
 * `expo-secure-store` throws on a value over 2048 bytes on iOS, and a
 * supabase-js session JSON is bigger than that. Chunk below the limit with
 * headroom, because the limit is on the encrypted payload rather than on our
 * string.
 */
const CHUNK_SIZE = 2000;

/** Written alongside the chunks so a read knows how many to reassemble. */
const COUNT_SUFFIX = '.n';

/** The prefix B4 keys cached months under. Cleared wholesale on sign-out. */
const OCCURRENCE_CACHE_PREFIX = 'occ:';

export function createAuthClient(opts: AuthClientOptions): AuthClient {
  const storage = opts.store ? chunkedStorage(opts.store) : undefined;

  const client: SupabaseClient = createClient(opts.supabaseUrl, opts.anonKey, {
    auth: {
      // A native app has no URL bar to read a token out of, and reading one on
      // web is the callback route's job, not the client's.
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: true,
      ...(storage ? { storage } : {}),
    },
  });

  return {
    storage: storage ?? passthroughStorage(),

    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data.session) throw new Error('Sign-in returned no session.');
      return data.session;
    },

    async signUpWithPassword(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      return data.session
        ? { status: 'signed-in', session: data.session }
        : { status: 'confirmation-required' };
    },

    async signInWithOAuth(provider) {
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: opts.redirectTo ? { redirectTo: opts.redirectTo } : undefined,
      });
      if (error) throw error;
    },

    async resetPassword(email) {
      // The error is discarded on purpose — see the interface. GoTrue answers
      // differently for a registered and an unregistered address, and passing
      // that difference to the caller is what would leak.
      await client.auth.resetPasswordForEmail(
        email,
        opts.redirectTo ? { redirectTo: opts.redirectTo } : undefined,
      );
    },

    async signOut() {
      // Cache first. If signOut throws after clearing, the worst case is a
      // cold calendar; clearing after a throw would leave the previous user's
      // occurrences readable on a shared device.
      await opts.cache?.clear(OCCURRENCE_CACHE_PREFIX);
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },

    async getSession() {
      const { data } = await client.auth.getSession();
      return data.session;
    },

    onAuthStateChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, session) => cb(session));
      return () => data.subscription.unsubscribe();
    },

    async getAccessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },

    async refresh() {
      const { data, error } = await client.auth.refreshSession();
      if (error) return null;
      return data.session?.access_token ?? null;
    },
  };
}

/**
 * A `SupportedStorage` over a `SessionStore`, splitting oversized values.
 *
 * Layout for a chunked value: `<key>.n` holds the chunk count, `<key>.0` ..
 * `<key>.<n-1>` hold the parts. A value that fits is written at `<key>` with no
 * count key, so the common case costs one read.
 */
export function chunkedStorage(store: SessionStore): SupportedStorage {
  return {
    async getItem(key) {
      const count = await store.get(countKey(key));
      if (count === null) return store.get(key);

      const total = Number.parseInt(count, 10);
      if (!Number.isInteger(total) || total < 1) return null;

      const parts: string[] = [];
      for (let i = 0; i < total; i += 1) {
        const part = await store.get(chunkKey(key, i));
        // A missing chunk means a partial write or a partial wipe. Returning
        // what we have would reassemble half a session and send a token that
        // belongs to neither.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key, value) {
      // Remove any previous layout first: going from chunked to unchunked
      // otherwise leaves a stale `<key>.n` that wins on the next read.
      await clear(store, key);

      if (value.length <= CHUNK_SIZE) {
        await store.set(key, value);
        return;
      }

      const total = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < total; i += 1) {
        await store.set(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      }
      await store.set(countKey(key), String(total));
    },

    async removeItem(key) {
      await clear(store, key);
    },
  };
}

async function clear(store: SessionStore, key: string): Promise<void> {
  const count = await store.get(countKey(key));
  if (count !== null) {
    const total = Number.parseInt(count, 10);
    for (let i = 0; i < (Number.isInteger(total) ? total : 0); i += 1) {
      await store.remove(chunkKey(key, i));
    }
    await store.remove(countKey(key));
  }
  await store.remove(key);
}

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

function countKey(key: string): string {
  return `${key}${COUNT_SUFFIX}`;
}

/**
 * Stands in for the adapter when the platform default is in use (web), so
 * `AuthClient.storage` is never undefined. supabase-js owns the real storage
 * in that case; this is not a second copy of it.
 */
function passthroughStorage(): SupportedStorage {
  return {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  };
}
