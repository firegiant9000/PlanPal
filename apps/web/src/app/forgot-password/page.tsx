'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { theme } from '@planpal/ui';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { getPlanPalClient } from '../../lib/planpalClient';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await getPlanPalClient().auth.resetPassword(email.trim());
    } finally {
      // One outcome, registered or not. `resetPassword` swallows GoTrue's
      // error for the same reason: anything else is an enumeration oracle.
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <main style={pageStyle}>
      <form
        style={formStyle}
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Text size="lg" weight="bold">
          Reset your password
        </Text>

        {sent ? (
          <Text color="textSecondary">
            If an account exists for that address, a reset link is on its way.
          </Text>
        ) : (
          <>
            <input
              style={inputStyle}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              aria-label="Email"
            />
            <Button
              label="Send reset link"
              onPress={() => void onSubmit()}
              loading={busy}
              disabled={email.trim() === ''}
            />
          </>
        )}

        <Link href="/sign-in" style={linkStyle}>
          Back to sign in
        </Link>
      </form>
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

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing.md,
  maxWidth: 360,
  width: '100%',
};

const inputStyle: CSSProperties = {
  backgroundColor: theme.colors.bgMuted,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.radius.md,
  color: theme.colors.textPrimary,
  fontFamily: theme.typography.fontFamily.sans,
  fontSize: theme.typography.fontSize.md,
  padding: theme.spacing.sm,
};

const linkStyle: CSSProperties = {
  color: theme.colors.accent,
  fontFamily: theme.typography.fontFamily.sans,
  fontSize: theme.typography.fontSize.sm,
};
