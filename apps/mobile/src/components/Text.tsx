import type { ReactNode } from 'react';
import { Text as RNText } from 'react-native';
import { theme } from '@planpal/ui';
import type { TextContract } from '@planpal/ui';

/** React Native implementation of the shared {@link TextContract}. */
const sizeToFontSize = {
  sm: theme.typography.fontSize.sm,
  md: theme.typography.fontSize.md,
  lg: theme.typography.fontSize.lg,
} as const;

const weightToValue = {
  regular: theme.typography.fontWeight.regular,
  medium: theme.typography.fontWeight.medium,
  semibold: theme.typography.fontWeight.semibold,
  bold: theme.typography.fontWeight.bold,
} as const;

export function Text({
  children,
  color = 'textPrimary',
  weight = 'regular',
  size = 'md',
}: TextContract & { children: ReactNode }) {
  return (
    <RNText
      style={{
        color: theme.colors[color],
        fontSize: sizeToFontSize[size],
        fontWeight: weightToValue[weight],
        fontFamily: theme.typography.fontFamily.sans,
      }}
    >
      {children}
    </RNText>
  );
}
