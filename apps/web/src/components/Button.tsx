'use client';

import { theme } from '@planpal/ui';
import type { ButtonContract, Size, Variant } from '@planpal/ui';

/**
 * DOM implementation of the shared {@link ButtonContract}. The mobile app
 * implements the same contract with React Native primitives — so a Button looks
 * and behaves the same on both platforms while each renders natively.
 */

const variantColors: Record<Variant, { bg: string; fg: string }> = {
  primary: { bg: theme.colors.accent, fg: theme.colors.textInverse },
  secondary: { bg: theme.colors.bgMuted, fg: theme.colors.textPrimary },
  ghost: { bg: 'transparent', fg: theme.colors.accent },
  danger: { bg: theme.colors.danger, fg: theme.colors.textInverse },
};

const sizePadding: Record<Size, string> = {
  sm: `${theme.spacing.xs}px ${theme.spacing.sm}px`,
  md: `${theme.spacing.sm}px ${theme.spacing.md}px`,
  lg: `${theme.spacing.md}px ${theme.spacing.lg}px`,
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
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onPress}
      style={{
        backgroundColor: colors.bg,
        color: colors.fg,
        padding: sizePadding[size],
        border: variant === 'ghost' ? `1px solid ${theme.colors.border}` : 'none',
        borderRadius: theme.radius.md,
        fontFamily: theme.typography.fontFamily.sans,
        fontWeight: theme.typography.fontWeight.semibold,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? '…' : label}
    </button>
  );
}
