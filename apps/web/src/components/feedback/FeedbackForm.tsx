'use client';

/**
 * FeedbackForm — M5 cross-cutting: in-app feedback / bug reports.
 *
 * Self-contained (no API call inside): the wrapping page calls `onSubmit`
 * with the assembled payload and performs `planpalClient.feedback.create(...)`,
 * attaching whatever `context` (current page, app version) it knows and this
 * form doesn't. There is no such page yet — see docs/M5_CROSS_CUTTING_PLAN.md —
 * so this component is built and tested ahead of the place it will be
 * reached from, mirroring the mobile app's `FeedbackForm` and the order this
 * session already used for `ParseResource.upload`, `pollJob`, and
 * `PrivacyDisclosure`.
 */
import { useState, type CSSProperties } from 'react';
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

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ message: message.trim() });
  }

  return (
    <form
      style={rootStyle}
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
    >
      <Text size="lg" weight="bold">
        Send feedback
      </Text>
      <Text color="textSecondary" size="sm">
        Found a bug or have an idea? Let us know — we read every message.
      </Text>

      <textarea
        style={textareaStyle}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="What's on your mind?"
        maxLength={MAX_LENGTH}
        rows={6}
        disabled={submitting}
        aria-label="Feedback message"
      />
      <Text color="textSecondary" size="sm">
        {message.length}/{MAX_LENGTH}
      </Text>

      <Button label="Send" onPress={handleSubmit} disabled={!canSubmit} loading={submitting} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={submitting} />
    </form>
  );
}

const rootStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing.sm,
  maxWidth: 480,
  padding: theme.spacing.lg,
};

const textareaStyle: CSSProperties = {
  backgroundColor: theme.colors.bgMuted,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.radius.md,
  color: theme.colors.textPrimary,
  fontFamily: theme.typography.fontFamily.sans,
  fontSize: theme.typography.fontSize.md,
  padding: theme.spacing.md,
  resize: 'vertical',
};
