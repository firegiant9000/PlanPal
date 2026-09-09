import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStorageCache, createPlanPalClient, type PlanPalClient } from '@planpal/api-client';
import { createSecureStore } from './session/secureStore';

/**
 * The mobile composition root — the one place the app builds its client.
 *
 * Screens import `planpalClient` from here and call `client.auth.*` /
 * `client.events.*`. Nothing in `app/` or `src/components/` may import
 * `supabase-js` or call `fetch`; B5's ESLint rule fails the build if it does.
 */

/**
 * Expo inlines `EXPO_PUBLIC_*` at build time, so a missing value is a missing
 * string rather than a runtime lookup that might succeed later. Failing here
 * turns that into one clear error at startup instead of an opaque 401 on the
 * first request.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill in the local stack's values.`,
    );
  }
  return value;
}

const supabaseUrl = required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
const anonKey = required(
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

/** Matches the `scheme` in app.json; the OAuth provider sends the user back here. */
export const AUTH_REDIRECT = 'planpal://auth/callback';

export const planpalClient: PlanPalClient = createPlanPalClient({
  supabaseUrl,
  anonKey,
  store: createSecureStore(),
  // Calendar months persist to AsyncStorage so the app opens with the last
  // known calendar and no network (T29, AD-10). Tokens do NOT go here — they
  // use `createSecureStore()` above, per AD-9.
  cache: createAsyncStorageCache(AsyncStorage),
  redirectTo: AUTH_REDIRECT,
});
