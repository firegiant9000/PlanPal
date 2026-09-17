/**
 * FeedbackForm — M5 cross-cutting: in-app feedback / bug reports.
 *
 * Self-contained (no API call inside), matching `CreateEventForm`'s
 * convention: the wrapping screen calls `onSubmit` with the assembled
 * payload and performs `planpalClient.feedback.create(...)`, attaching
 * whatever `context` (current screen, app version) it knows and this form
 * doesn't. There is no such screen yet — see docs/M5_CROSS_CUTTING_PLAN.md —
 * so this component is built and tested ahead of the place it will be
 * reached from, the same order this session already used for
 * `ParseResource.upload`, `pollJob`, and `PrivacyDisclosure`.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { theme } from '@planpal/ui';
import { Button } from '../Button';
import { Text } from '../Text';

const MAX_LENGTH = 2000;

export interface FeedbackFormPayload {
  message: string;
}

interface FeedbackFormProps {
  onSubmit: (payload: FeedbackFormPayload) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function FeedbackForm({ onSubmit, onCancel, submitting = false }: FeedbackFormProps) {
  const [message, setMessage] = useState('');

  const canSubmit = message.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({ message: message.trim() });
  }, [canSubmit, message, onSubmit]);

  return (
    <View style={styles.root}>
      <Text size="lg" weight="bold">
        Send feedback
      </Text>
      <Text color="textSecondary" size="sm">
        Found a bug or have an idea? Let us know — we read every message.
      </Text>

      <TextInput
        style={styles.input}
        value={message}
        onChangeText={setMessage}
        placeholder="What's on your mind?"
        placeholderTextColor={theme.colors.textSecondary}
        multiline
        numberOfLines={6}
        maxLength={MAX_LENGTH}
        textAlignVertical="top"
        editable={!submitting}
      />
      <Text color="textSecondary" size="sm">
        {message.length}/{MAX_LENGTH}
      </Text>

      <Button label="Send" onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  input: {
    backgroundColor: theme.colors.bgMuted,
    borderRadius: theme.radius.md,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    minHeight: 120,
    padding: theme.spacing.md,
  },
});
