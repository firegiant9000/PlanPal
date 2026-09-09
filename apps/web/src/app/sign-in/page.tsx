'use client';

import { useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { theme } from '@planpal/ui';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { getPlanPalClient } from '../../lib/planpalClient';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await getPlanPalClient().auth.signInWithPassword(email.trim(), password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
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
          Sign in
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
          autoComplete="current-password"
          aria-label="Password"
        />

        {error === null ? null : (
          <Text color="danger" size="sm">
            {error}
          </Text>
        )}

        <Button
          label="Sign in"
          onPress={() => void onSubmit()}
          loading={busy}
          disabled={email.trim() === '' || password === ''}
        />

        {/* T6 has not landed. A button that silently does nothing is worse than
            an absent one, so it is disabled and the reason is on screen. */}
        <Button label="Continue with Google" variant="secondary" disabled onPress={() => {}} />
        <Text color="textSecondary" size="sm">
          Google sign-in arrives with T6. Apple follows with T3.
        </Text>

        <Link href="/sign-up" style={linkStyle}>
          Create an account
        </Link>
        <Link href="/forgot-password" style={linkStyle}>
          Forgot your password?
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
