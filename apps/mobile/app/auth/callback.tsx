import { useEffect } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@planpal/ui';
import { Text } from '../../src/components/Text';
import { useSession } from '../../src/lib/session/useSession';

/**
 * Landing point for `planpal://auth/callback` — the deep link an OAuth
 * provider returns to. The scheme is already declared in `app.json`.
 *
 * It deliberately does no token parsing. `createAuthClient` sets
 * `detectSessionInUrl: false` because a native app has no URL bar; supabase-js
 * handles the exchange and publishes the result through `onAuthStateChange`,
 * which `useSession` is already subscribed to. This screen's only job is to
 * wait for that and get out of the way.
 *
 * Until T6 lands there is no configured provider, so in practice this is
 * reached only by a hand-fired deep link. It is wired now so the route exists
 * when the provider is switched on.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/' : '/sign-in');
  }, [loading, session, router]);

  return (
    <SafeAreaView style={styles.screen}>
      <ActivityIndicator color={theme.colors.accent} />
      <Text color="textSecondary">Finishing sign-in…</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: 'center',
  },
});
