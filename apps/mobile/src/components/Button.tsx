import { Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '@planpal/ui';
import type { ButtonContract, Size, Variant } from '@planpal/ui';

/**
 * React Native implementation of the shared {@link ButtonContract}. The web app
 * implements the same contract against the DOM — same props, native rendering.
 */

const variantColors: Record<Variant, { bg: string; fg: string }> = {
  primary: { bg: theme.colors.accent, fg: theme.colors.textInverse },
  secondary: { bg: theme.colors.bgMuted, fg: theme.colors.textPrimary },
  ghost: { bg: 'transparent', fg: theme.colors.accent },
  danger: { bg: theme.colors.danger, fg: theme.colors.textInverse },
};

const sizePadding: Record<Size, { v: number; h: number }> = {
  sm: { v: theme.spacing.xs, h: theme.spacing.sm },
  md: { v: theme.spacing.sm, h: theme.spacing.md },
  lg: { v: theme.spacing.md, h: theme.spacing.lg },
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  onPress,
}: ButtonContract) {
  const colors = variantColors[variant];
  const pad = sizePadding[size];
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      onPress={onPress}
      style={{
        backgroundColor: colors.bg,
        paddingVertical: pad.v,
        paddingHorizontal: pad.h,
        borderRadius: theme.radius.md,
        borderWidth: variant === 'ghost' ? 1 : 0,
        borderColor: theme.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={[styles.label, { color: colors.fg }]}>{loading ? '…' : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    fontFamily: theme.typography.fontFamily.sans,
    fontWeight: theme.typography.fontWeight.semibold,
    textAlign: 'center',
  },
});
