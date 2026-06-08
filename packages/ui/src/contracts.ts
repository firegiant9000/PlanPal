import type { ColorToken, SpacingToken } from '@planpal/design-tokens';

/**
 * Cross-platform component prop contracts. Each app provides a concrete
 * implementation (RN or DOM) that satisfies these shapes, so a `Button` looks
 * and behaves the same on mobile and web.
 */

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type Size = 'sm' | 'md' | 'lg';

export interface ButtonContract {
  label: string;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}

export interface TextContract {
  color?: ColorToken;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  size?: Size;
}

export interface StackContract {
  gap?: SpacingToken;
  direction?: 'row' | 'column';
  align?: 'start' | 'center' | 'end' | 'stretch';
}
