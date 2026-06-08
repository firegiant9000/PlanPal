'use client';

import { theme } from '@planpal/ui';
import { Button } from '../components/Button';
import { Text } from '../components/Text';
import { getAnalytics } from '../lib/observability';

/**
 * Phase 3 scaffold home screen. Proves the web app builds, consumes the shared
 * design tokens, and renders the @planpal/ui contracts (Button/Text) — the real
 * calendar UI lands in M3.
 */
export default function HomePage() {
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
      <Text color="textSecondary">Web scaffold — design tokens wired, contracts rendered.</Text>
      <Button
        label="Create event"
        onPress={() =>
          getAnalytics().track('event_created', { source: 'manual', is_recurring: false })
        }
      />
    </main>
  );
}
