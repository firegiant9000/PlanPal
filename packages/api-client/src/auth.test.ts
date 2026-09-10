import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuthClient, type SessionStore } from './auth';

/**
 * supabase-js is stubbed for the whole file, deliberately.
 *
 * Without this, `signOut()` reaches for a real GoTrue at the configured URL —
 * so the unit suite would pass or fail depending on whether a local stack
 * happens to be running, which is the worst kind of flake. The live path is
 * proved against the real stack in B6.
 */
const gotrue = vi.hoisted(() => ({
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  refreshSession: vi.fn(() =>
    Promise.resolve({ data: { session: { access_token: 'access-2' } }, error: null }),
  ),
  getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(() => Promise.resolve({ error: null })),
  resetPasswordForEmail: vi.fn(() => Promise.resolve({ error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: gotrue })),
}));

/**
 * The session layer, against a fake store.
 *
 * The chunking is not incidental: `expo-secure-store` rejects a value over
 * 2048 bytes on iOS, and a supabase-js session JSON is larger than that. The
 * limit lives here rather than in the mobile app so both platforms share one
 * implementation — Android has no such limit, so an Android-only dogfood
 * window would never surface the bug (specs §B, risk).
 */

/** A `SessionStore` backed by a Map, so keys written can be inspected. */
function fakeStore() {
  const values = new Map<string, string>();
  const store: SessionStore = {
    get: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
  };
  return { store, values };
}

function fakeCache() {
  return { clear: vi.fn(() => Promise.resolve()) };
}

/** A session JSON comfortably over the iOS Keychain limit. */
function oversizedSession(): string {
  return JSON.stringify({
    access_token: 'a'.repeat(1600),
    refresh_token: 'r'.repeat(1600),
    expires_at: 1_800_000_000,
    token_type: 'bearer',
    user: { id: '00000000-0000-0000-0000-000000000001', email: 'dogfood@example.com' },
  });
}

const OPTIONS = {
  supabaseUrl: 'http://127.0.0.1:54321',
  anonKey: 'anon-key-for-tests',
};

let localStorageTouched: boolean;

beforeEach(() => {
  localStorageTouched = false;
  // AD-9: mobile tokens must go through the injected store, never through a
  // web storage global. If supabase-js reaches for one, this notices.
  vi.stubGlobal('localStorage', {
    getItem: () => {
      localStorageTouched = true;
      return null;
    },
    setItem: () => {
      localStorageTouched = true;
    },
    removeItem: () => {
      localStorageTouched = true;
    },
  });
});

describe('createAuthClient', () => {
  it('persists the session through the provided SessionStore, never localStorage directly', async () => {
    const { store, values } = fakeStore();
    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });

    await auth.storage.setItem('planpal-auth-token', JSON.stringify({ access_token: 'short' }));

    expect(store.set).toHaveBeenCalled();
    expect([...values.keys()].length).toBeGreaterThan(0);
    expect(localStorageTouched).toBe(false);
  });

  it('chunks a stored value larger than 2048 bytes across multiple keys', async () => {
    const { store, values } = fakeStore();
    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });
    const session = oversizedSession();
    expect(session.length).toBeGreaterThan(3000);

    await auth.storage.setItem('planpal-auth-token', session);

    // More than one key, and no single stored value over the limit — asserting
    // only that the round-trip works would pass with one oversized write, which
    // is exactly the bug.
    expect([...values.keys()].length).toBeGreaterThan(1);
    for (const [key, value] of values) {
      expect(value.length, `${key} is over the iOS Keychain limit`).toBeLessThanOrEqual(2048);
    }
  });

  it('reassembles a chunked value on read', async () => {
    const { store } = fakeStore();
    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });
    const session = oversizedSession();

    await auth.storage.setItem('planpal-auth-token', session);

    await expect(auth.storage.getItem('planpal-auth-token')).resolves.toBe(session);
  });

  it('restores a session from the store on cold start', async () => {
    // Distinct from the test above, which writes and reads through ONE client.
    // A cold start is a new process: the adapter is reconstructed and nothing
    // in memory survives. If the storage layer ever grew an in-memory cache,
    // the test above would still pass and the app would still sign users out
    // on every launch — which is the bug this exists to catch.
    const { store } = fakeStore();
    const session = oversizedSession();

    const firstLaunch = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });
    await firstLaunch.storage.setItem('planpal-auth-token', session);

    const afterRestart = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });

    await expect(afterRestart.storage.getItem('planpal-auth-token')).resolves.toBe(session);
    // Restored from the injected store, not from a web global (AD-9).
    expect(localStorageTouched).toBe(false);
  });

  it('sends a password reset to the configured redirect, and reports nothing about the address', async () => {
    const { store } = fakeStore();
    const auth = createAuthClient({
      ...OPTIONS,
      store,
      cache: fakeCache(),
      redirectTo: 'planpal://auth/callback',
    });

    await auth.resetPassword('someone@example.com');

    expect(gotrue.resetPasswordForEmail).toHaveBeenCalledWith('someone@example.com', {
      redirectTo: 'planpal://auth/callback',
    });
  });

  it('does not reveal whether an address is registered when the reset fails', async () => {
    // GoTrue can answer with an error for an unregistered address. Surfacing it
    // turns the forgot-password form into an account-enumeration oracle, so the
    // client swallows it and the screen always says the same thing.
    const { store } = fakeStore();
    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });
    gotrue.resetPasswordForEmail.mockResolvedValueOnce({
      error: { message: 'User not found' },
    } as never);

    await expect(auth.resetPassword('nobody@example.com')).resolves.toBeUndefined();
  });

  it('clears every chunk on signOut', async () => {
    const { store, values } = fakeStore();
    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });
    await auth.storage.setItem('planpal-auth-token', oversizedSession());
    expect([...values.keys()].length).toBeGreaterThan(1);

    await auth.storage.removeItem('planpal-auth-token');

    // A leftover chunk is worse than none: the next read reassembles a partial
    // session and the client sends a token that is half of two sessions.
    expect([...values.keys()]).toEqual([]);
  });

  it('signOut clears the occurrence cache prefix', async () => {
    const { store } = fakeStore();
    const cache = fakeCache();
    const auth = createAuthClient({ ...OPTIONS, store, cache });

    await auth.signOut();

    // A shared device must not show the previous user's calendar.
    expect(cache.clear).toHaveBeenCalledWith('occ:');
  });

  it('clears the cache before revoking the session, not after', async () => {
    // If the order were reversed and signOut threw, the previous user's
    // occurrences would stay readable on the device.
    const order: string[] = [];
    const { store } = fakeStore();
    const cache = {
      clear: vi.fn(() => {
        order.push('cache');
        return Promise.resolve();
      }),
    };
    gotrue.signOut.mockImplementation(() => {
      order.push('gotrue');
      return Promise.resolve({ error: null });
    });

    await createAuthClient({ ...OPTIONS, store, cache }).signOut();

    expect(order).toEqual(['cache', 'gotrue']);
  });

  it('refresh() resolves null rather than throwing when the session cannot be renewed', async () => {
    // createHttp's contract: `refresh()` returns a token or null. A throw here
    // would escape as an unhandled rejection instead of the client's
    // UNAUTHENTICATED, and its no-new-token path would never run.
    const { store } = fakeStore();
    gotrue.refreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'refresh_token_not_found' },
    } as never);

    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });

    await expect(auth.refresh()).resolves.toBeNull();
  });

  it('getAccessToken() resolves null when there is no session', async () => {
    const { store } = fakeStore();
    const auth = createAuthClient({ ...OPTIONS, store, cache: fakeCache() });

    await expect(auth.getAccessToken()).resolves.toBeNull();
  });
});

describe('signUpWithPassword', () => {
  beforeEach(() => {
    gotrue.signUp.mockReset();
  });

  it('reports confirmation-required when GoTrue returns no session', async () => {
    gotrue.signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null });
    const auth = createAuthClient(OPTIONS);

    await expect(auth.signUpWithPassword('new@example.com', 'password123')).resolves.toEqual({
      status: 'confirmation-required',
    });
  });

  it('returns the session when confirmations are off', async () => {
    const session = { access_token: 'access-1' };
    gotrue.signUp.mockResolvedValue({ data: { session, user: { id: 'u1' } }, error: null });
    const auth = createAuthClient(OPTIONS);

    await expect(auth.signUpWithPassword('new@example.com', 'password123')).resolves.toEqual({
      status: 'signed-in',
      session,
    });
  });

  it('still throws a real GoTrue error', async () => {
    gotrue.signUp.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('Password should be at least 6 characters'),
    });
    const auth = createAuthClient(OPTIONS);

    await expect(auth.signUpWithPassword('new@example.com', 'x')).rejects.toThrow(
      'Password should be at least 6 characters',
    );
  });
});
