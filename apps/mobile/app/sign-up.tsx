import { useState } from 'react';
import { SafeAreaView, StyleSheet, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { theme } from '@planpal/ui';
import { Button } from '../src/components/Button';
import { Text } from '../src/components/Text';
import { planpalClient } from '../src/lib/planpalClient';

export default function SignUpScreen() {
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
      const result = await planpalClient.auth.signUpWithPassword(email.trim(), password);
      setNotice(
        result.status === 'signed-in'
          ? 'Account created. You can sign in now.'
          : 'Account created. Check your email to confirm it before signing in.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.form}>
        <Text size="lg" weight="bold">
          Create an account
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
          autoComplete="new-password"
          secureTextEntry
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
          onPress={onSubmit}
          loading={busy}
          disabled={email.trim() === '' || password === ''}
        />

        <Link href="/sign-in">
          <Text color="accent">Already have an account? Sign in</Text>
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
