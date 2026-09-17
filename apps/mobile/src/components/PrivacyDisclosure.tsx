import { StyleSheet, View } from 'react-native';
import { theme } from '@planpal/ui';
import { Button } from './Button';
import { Text } from './Text';

/**
 * The MONTH5.md-required privacy notice for the screenshot-parse pipeline.
 *
 * Two `mode`s, one component, because the copy is identical either way —
 * only what dismissing means differs:
 *   - `'gate'`: first time, blocks progress until acknowledged. The caller
 *     persists the acknowledgment (via `acknowledgeDisclosure`) in `onDismiss`
 *     before proceeding to the picker.
 *   - `'review'`: already acknowledged, reopened later (e.g. from settings).
 *     `onDismiss` just closes it — nothing to persist again.
 *
 * Deliberately not wired into the upload flow yet: the picker/upload screen
 * this gates (docs/M5_UPLOAD_UX_PLAN.md, Task 3) doesn't exist yet. This
 * component and `lib/privacyDisclosure.ts`'s persistence are what that screen
 * will call `hasAcknowledgedDisclosure`/`acknowledgeDisclosure` and render
 * against once it does.
 */
export type PrivacyDisclosureMode = 'gate' | 'review';

interface PrivacyDisclosureProps {
  mode: PrivacyDisclosureMode;
  onDismiss: () => void;
}

export function PrivacyDisclosure({ mode, onDismiss }: PrivacyDisclosureProps) {
  return (
    <View style={styles.root} accessibilityRole="alert">
      <Text size="lg" weight="semibold">
        Before you scan a schedule
      </Text>
      <Text color="textSecondary" size="sm">
        Screenshots you scan are sent to a third-party AI service so PlanPal
        can read the schedule in them. They are used only to process that
        scan and are not retained afterward.
      </Text>
      <Button
        label={mode === 'gate' ? 'I understand, continue' : 'Close'}
        onPress={onDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.lg,
  },
});
