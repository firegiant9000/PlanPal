'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { theme } from '@planpal/ui';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { getPlanPalClient } from '../../lib/planpalClient';

/** See apps/mobile/app/sign-up.tsx — the happy path arrives as an exception. */
const CONFIRMATION_REQUIRED = 'Check your email to confirm the account before signing in.';

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await getPlanPalClient().auth.signUpWithPassword(email.trim(), password);
      setNotice('Account created. You can sign in now.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not create the account.';
      if (message === CONFIRMATION_REQUIRED) setNotice(message);
      else setError(message);
    } finally {
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
          Create an account
        </Text>

        <input
          style={inputStyle}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          aria-label="Email"
        />
        <input
          style={inputStyle}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="new-password"
          aria-label="Password"
        />

        {error === null ? null : (
          <Text color="danger" size="sm">
            {error}
          </Text>
        )}
        {notice === null ? null : (
          <Text color="success" size="sm">
            {notice}
          </Text>
        )}

        <Button
          label="Create account"
          onPress={() => void onSubmit()}
          loading={busy}
          disabled={email.trim() === '' || password === ''}
        />

        <Link href="/sign-in" style={linkStyle}>
          Already have an account? Sign in
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
