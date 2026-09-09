import { useEffect } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { theme } from '@planpal/ui';
import { initObservability } from '../src/lib/observability';
import { useSession } from '../src/lib/session/useSession';
import { registerPushToken } from '../src/lib/registerPushToken';

/**
 * Route groups reachable without a session. `auth` covers the OAuth callback,
 * which must be reachable precisely when there is not yet a session.
 */
const PUBLIC_SEGMENTS = new Set(['sign-in', 'sign-up', 'forgot-password', 'auth']);

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { session, loading } = useSession();

  useEffect(() => {
    initObservability();
  }, []);

  useEffect(() => {
    // Only once there is a session: `POST /me/devices` binds the token to the
    // signed-in user, so registering before sign-in would 401, and registering
    // on every render would re-POST on each token refresh.
    if (!session) return;
    void registerPushToken().then((outcome) => {
      // Every other outcome is fine to stay quiet about — reminders are
      // additive. A conflict is not: this token belongs to another account, so
      // until it is resolved that account keeps receiving this phone's
      // reminders and this user silently receives none.
      if (outcome === 'conflict') {
        Alert.alert(
          'Reminders are going elsewhere',
          'This device is still registered to a different PlanPal account. Sign in on that account and sign out, or contact support, or you will not receive reminders here.',
        );
      }
    });
  }, [session]);

  useEffect(() => {
    // Do nothing until the Keychain read has resolved. Redirecting while
    // `loading` is true signs the user out on every cold start, because a
    // restored session is simply not back yet.
    if (loading) return;

    const isPublic = PUBLIC_SEGMENTS.has(segments[0] ?? '');

    if (!session && !isPublic) {
      router.replace('/sign-in');
    } else if (session && isPublic && segments[0] !== 'auth') {
      // Signed in but sitting on sign-in/sign-up: send them to the calendar so
      // the back stack never contains an auth screen while authenticated.
      router.replace('/');
    }
  }, [loading, session, segments, router]);

  // Render nothing decisive while restoring: showing the calendar would flash
  // another user's shell, and showing sign-in would flash a logged-out state
  // at someone who is signed in.
  if (loading) {
    return (
      <View
        style={{
          alignItems: 'center',
          backgroundColor: theme.colors.bg,
          flex: 1,
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
