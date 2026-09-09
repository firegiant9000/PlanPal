import { useState } from 'react';
import { SafeAreaView, StyleSheet, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { theme } from '@planpal/ui';
import { Button } from '../src/components/Button';
import { Text } from '../src/components/Text';
import { planpalClient } from '../src/lib/planpalClient';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true);
    try {
      await planpalClient.auth.resetPassword(email.trim());
    } finally {
      // Always the same outcome, whether or not the address is registered.
      // `resetPassword` swallows GoTrue's error for the same reason: a form
      // that answers differently is an account-enumeration oracle.
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.form}>
        <Text size="lg" weight="bold">
          Reset your password
        </Text>

        {sent ? (
          <Text color="textSecondary">
            If an account exists for that address, a reset link is on its way.
          </Text>
        ) : (
          <>
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
            <Button
              label="Send reset link"
              onPress={onSubmit}
              loading={busy}
              disabled={email.trim() === ''}
            />
          </>
        )}

        <Link href="/sign-in">
          <Text color="accent">Back to sign in</Text>
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
