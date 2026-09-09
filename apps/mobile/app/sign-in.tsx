import { useState } from 'react';
import { SafeAreaView, StyleSheet, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { theme } from '@planpal/ui';
import { Button } from '../src/components/Button';
import { Text } from '../src/components/Text';
import { planpalClient } from '../src/lib/planpalClient';

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    setError(null);
    try {
      await planpalClient.auth.signInWithPassword(email.trim(), password);
      // `replace`, not `push`: the sign-in screen must not stay on the back
      // stack, or the hardware back button returns to it while signed in.
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.form}>
        <Text size="lg" weight="bold">
          Sign in
        </Text>

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
        />

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={theme.colors.textSecondary}
          autoCapitalize="none"
          autoComplete="current-password"
          secureTextEntry
        />

        {error === null ? null : (
          <Text color="danger" size="sm">
            {error}
          </Text>
        )}

        <Button
          label="Sign in"
          onPress={onSubmit}
          loading={busy}
          disabled={email.trim() === '' || password === ''}
        />

        {/*
          T6 has not landed, so Google is not configured on the project. A
          button that silently does nothing is worse than an absent one, so it
          is disabled and says why (T7 DoD).
        */}
        <Button label="Continue with Google" variant="secondary" disabled onPress={() => {}} />
        <Text color="textSecondary" size="sm">
          Google sign-in arrives with T6. Apple follows with T3.
        </Text>

        <Link href="/sign-up">
          <Text color="accent">Create an account</Text>
        </Link>
        <Link href="/forgot-password">
          <Text color="accent">Forgot your password?</Text>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  form: { flex: 1, gap: theme.spacing.md, justifyContent: 'center', padding: theme.spacing.lg },
  input: {
    backgroundColor: theme.colors.bgMuted,
    borderRadius: theme.radius.md,
    color: theme.colors.textPrimary,
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.md,
    padding: theme.spacing.md,
  },
});
