import { StyleSheet, View } from 'react-native';
import { theme } from '@planpal/ui';
import { Button } from '../components/Button';
import { Text } from '../components/Text';

/**
 * The four states a calendar screen can be in besides "here are your events".
 *
 * §P4 calls these work rather than polish, and they are here as one module so
 * that adding a fifth is a change in one place rather than four screens. Each
 * says what happened and what the user can do next; none of them is a bare
 * spinner or a silent blank.
 */

export type CalendarStateKind = 'empty' | 'failed' | 'offline' | 'forbidden' | 'editsBlocked';

/** The edits-blocked copy, for callers that need it outside a rendered state. */
export const EDITS_BLOCKED =
  'You can read your calendar, but changes need a connection. Nothing was lost.';

interface CalendarStateProps {
  kind: CalendarStateKind;
  /** Omitted for `empty`, which has nothing to retry. */
  onRetry?: () => void;
}

const COPY: Record<CalendarStateKind, { title: string; body: string; retry: boolean }> = {
  empty: {
    title: 'Nothing scheduled',
    body: 'Tap + to add your first event for this month.',
    retry: false,
  },
  failed: {
    title: "Couldn't load your calendar",
    body: 'Something went wrong reaching PlanPal. Your events are safe.',
    retry: true,
  },
  offline: {
    title: 'You are offline',
    body: 'Showing nothing rather than something stale. Reconnect to see this month.',
    retry: true,
  },
  forbidden: {
    title: 'Session expired',
    body: 'Sign in again to see this calendar.',
    retry: true,
  },
  // Offline EDITING is Post-V1 (T29 explicitly scopes itself to read-only), so
  // a write attempt has to explain itself. The failure mode this replaces is a
  // request that throws a network error the user cannot interpret.
  editsBlocked: { title: 'You are offline', body: EDITS_BLOCKED, retry: false },
};

export function CalendarState({ kind, onRetry }: CalendarStateProps) {
  const copy = COPY[kind];
  return (
    <View style={styles.container} accessibilityRole="summary">
      <Text size="lg" weight="semibold">
        {copy.title}
      </Text>
      <Text color="textSecondary" size="sm">
        {copy.body}
      </Text>
      {copy.retry && onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: theme.spacing.sm,
    justifyContent: 'center',
    padding: theme.spacing.lg,
  },
});
