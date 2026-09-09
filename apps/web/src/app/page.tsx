'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { theme } from '@planpal/ui';
import { Text } from '../components/Text';
import { useSession } from '../lib/useSession';

/**
 * The root route is now a router, not a screen.
 *
 * A signed-in user goes to `/calendar` (T20); a signed-out one is already being
 * sent to `/sign-in` by `AuthGuard`, so this renders only during the moment
 * between the session resolving and the redirect landing.
 */
export default function HomePage() {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (session) router.replace('/calendar');
  }, [loading, session, router]);

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md,
        alignItems: 'flex-start',
        padding: theme.spacing['2xl'],
      }}
    >
      <Text size="lg" weight="bold">
        PlanPal
      </Text>
      <Text color="textSecondary">Opening your calendar…</Text>
    </main>
  );
}
