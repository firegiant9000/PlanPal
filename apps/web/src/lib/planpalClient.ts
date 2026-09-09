'use client';

import { createPlanPalClient, type PlanPalClient } from '@planpal/api-client';

/**
 * The web composition root — the one place the app builds its client.
 *
 * No `store` is passed: per AD-9 web uses supabase-js's own localStorage
 * adapter, and the chunking that mobile needs for the iOS Keychain would be
 * pure overhead here. Mobile injects `expo-secure-store` instead.
 *
 * Built LAZILY on purpose. Next renders these modules on the server too, where
 * `window` and `localStorage` do not exist; constructing at module scope would
 * throw during the build rather than in the browser. Every caller is a client
 * component, so by the time this runs there is a real DOM.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill in the local stack's values.`,
    );
  }
  return value;
}

let client: PlanPalClient | undefined;

export function getPlanPalClient(): PlanPalClient {
  if (!client) {
    client = createPlanPalClient({
      supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
      anonKey: required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      // Absolute, and read at call time rather than baked in, so the same build
      // works on localhost, a preview URL and production.
      redirectTo: `${window.location.origin}/auth/callback`,
    });
  }
  return client;
}
