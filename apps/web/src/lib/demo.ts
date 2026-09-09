/**
 * The demo account, published on purpose.
 *
 * These credentials are in the README and in this file because the demo's
 * whole job is one-click access for a reviewer who will not register. The
 * account is seeded by supabase/seed.demo.sql, reseeded nightly, and holds
 * nothing but generated sample events. RLS confines it to its own rows like
 * any other account.
 *
 * Overridable by env so a fork can point the button at its own demo project
 * without editing source.
 */
export const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? 'demo@planpal.app';
export const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? 'planpal-demo';

/** False disables the affordance — set NEXT_PUBLIC_DEMO_ENABLED=false to hide it. */
export function isDemoEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_ENABLED !== 'false';
}
