/**
 * @planpal/design-tokens — primitive design values shared by mobile (RN/Expo)
 * and web (Next.js). Tokens are framework-agnostic plain values so each platform
 * can map them to its own styling system (StyleSheet, CSS vars, Tailwind, etc.).
 *
 * Phase 0 baseline: enough to keep the two clients visually consistent before
 * parallel UI work begins. Expand deliberately — every token added here is a
 * contract both apps depend on.
 */

export * from './color';
export * from './spacing';
export * from './typography';
export * from './radius';

import { colors } from './color';
import { spacing } from './spacing';
import { typography } from './typography';
import { radius } from './radius';

export const tokens = {
  colors,
  spacing,
  typography,
  radius,
} as const;

export type Tokens = typeof tokens;
