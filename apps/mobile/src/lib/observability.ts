import { noopAnalytics, type AnalyticsClient } from '@planpal/analytics';

/**
 * Light, env-driven observability init (Phase 3) for the mobile app.
 *
 * SCOPE: this reads the EXPO_PUBLIC_* keys and exposes the analytics client the
 * app calls. The concrete native SDKs (posthog-react-native, @sentry/react-native)
 * are intentionally NOT wired here — they require Expo config plugins + a native
 * rebuild (a prebuild/EAS step, like the other manual cloud items in BOOTSTRAP.md).
 * Until that step, this stays a no-op so the JS app runs and type-checks cleanly.
 * Swap `noopAnalytics` for `createAnalyticsClient({ capture, identify, reset })`
 * backed by posthog-react-native when the native step lands. See docs/METRICS.md.
 */
let analytics: AnalyticsClient = noopAnalytics;

export function initObservability(): void {
  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!posthogKey && !sentryDsn) return;
  // Native SDK init goes here once the Expo config plugins are added.
  analytics = noopAnalytics;
}

/** The active analytics client (no-op until the native SDKs are wired). */
export function getAnalytics(): AnalyticsClient {
  return analytics;
}
