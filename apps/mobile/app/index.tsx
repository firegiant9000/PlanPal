import { View } from 'react-native';
import { theme } from '@planpal/ui';
import { Button } from '../src/components/Button';
import { Text } from '../src/components/Text';
import { getAnalytics } from '../src/lib/observability';

/**
 * Phase 3 scaffold home screen. Proves the Expo app boots through expo-router,
 * consumes the shared design tokens, and renders the @planpal/ui contracts with
 * native primitives — the real calendar UI lands in M3.
 */
export default function HomeScreen() {
  return (
    <View
      style={{
        flex: 1,
        gap: theme.spacing.md,
        padding: theme.spacing['2xl'],
        backgroundColor: theme.colors.bg,
        justifyContent: 'center',
      }}
    >
      <Text size="lg" weight="bold">
        PlanPal
      </Text>
      <Text color="textSecondary">Mobile scaffold — design tokens wired, contracts rendered.</Text>
      <Button
        label="Create event"
        onPress={() =>
          getAnalytics().track('event_created', { source: 'manual', is_recurring: false })
        }
      />
    </View>
  );
}
