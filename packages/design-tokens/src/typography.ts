/**
 * Type scale. `fontFamily` is left platform-default at Phase 0 — set per-app
 * once the brand font is chosen, keeping sizes/weights shared here.
 */
export const typography = {
  fontFamily: {
    sans: 'System',
    mono: 'Menlo',
  },
  fontSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
    xl: 24,
    '2xl': 32,
  },
  fontWeight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
  },
} as const;

export type FontSizeToken = keyof typeof typography.fontSize;
