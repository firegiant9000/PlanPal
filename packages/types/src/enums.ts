/**
 * Stable enum-like constants shared across layers. Kept as const objects (not
 * TS `enum`) so they erase cleanly and serialize as plain strings over the wire.
 */

export const Visibility = {
  Private: 'private',
  SharedAll: 'shared_all',
  SharedSelect: 'shared_select',
  SensitivePublic: 'sensitive_public',
} as const;
export type Visibility = (typeof Visibility)[keyof typeof Visibility];

export const Environment = {
  Dev: 'dev',
  Staging: 'staging',
  Prod: 'prod',
} as const;
export type Environment = (typeof Environment)[keyof typeof Environment];
