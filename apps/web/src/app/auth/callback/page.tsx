'use client';

import { useEffect, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { theme } from '@planpal/ui';
import { Text } from '../../../components/Text';
import { useSession } from '../../../lib/useSession';

/**
 * Landing route for an OAuth redirect.
 *
 * KNOWN GAP, and it belongs to T6 rather than to T7. `createAuthClient` sets
 * `detectSessionInUrl: false`, so supabase-js will NOT pick a code out of the
 * URL by itself — auth.ts says that reading it is "the callback route's job".
 * But completing a PKCE exchange needs `exchangeCodeForSession`, which
 * `AuthClient` does not expose, and this app may not import supabase-js
 * directly (§15, enforced by B5's lint rule).
 *
 * That is not papered over here, because the alternative — reaching past the
 * client — is the exact coupling AD-7 exists to prevent. Nothing reaches this
 * route today: Google is not configured until T6 and both OAuth buttons are
 * disabled. T6 adds the missing method to `AuthClient` and this route calls it.
 *
 * Until then it handles the one case it can: a session that already exists.
 */
export default function AuthCallbackPage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    router.replace(session ? '/' : '/sign-in');
  }, [loading, session, router]);

  return (
    <main style={pageStyle}>
      <Text color="textSecondary">Finishing sign-in…</Text>
    </main>
  );
}

const pageStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'center',
  minHeight: '100vh',
  padding: theme.spacing.lg,
};
