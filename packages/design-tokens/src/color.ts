/**
 * Color primitives + semantic roles. Reference primitives from semantic roles,
 * and reference *roles* (not primitives) from components, so theming stays cheap.
 */

const primitives = {
  white: '#ffffff',
  black: '#0b0b0f',
  brand500: '#5b6cff',
  brand600: '#4453e6',
  gray50: '#f7f8fa',
  gray100: '#eceef2',
  gray300: '#c7ccd6',
  gray500: '#7b818f',
  gray700: '#3b4150',
  gray900: '#171a21',
  red500: '#e5484d',
  amber500: '#ffb224',
  green500: '#30a46c',
} as const;

export const colors = {
  ...primitives,
  // Semantic roles — components should prefer these.
  bg: primitives.white,
  bgMuted: primitives.gray50,
  surface: primitives.white,
  border: primitives.gray100,
  textPrimary: primitives.gray900,
  textSecondary: primitives.gray500,
  textInverse: primitives.white,
  accent: primitives.brand500,
  accentPressed: primitives.brand600,
  danger: primitives.red500,
  warning: primitives.amber500,
  success: primitives.green500,
  /** Gray "Busy" block for sensitive-public events (time/duration only). */
  busyBlock: primitives.gray300,
} as const;

export type ColorToken = keyof typeof colors;
