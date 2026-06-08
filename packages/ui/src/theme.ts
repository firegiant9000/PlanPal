import { tokens, type Tokens } from '@planpal/design-tokens';

/**
 * The app theme is the design tokens, surfaced through a single import so apps
 * depend on `@planpal/ui` rather than reaching into tokens directly. Dark mode /
 * alternate themes slot in here later without changing component call sites.
 */
export const theme: Tokens = tokens;

export type Theme = Tokens;
