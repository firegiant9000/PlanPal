import * as Sentry from '@sentry/react-native';
import PostHog from 'posthog-react-native';
import { createAnalyticsClient, noopAnalytics, type AnalyticsClient } from '@planpal/analytics';

/**
 * Env-driven observability init for the mobile app (T24).
 *
 * Both SDKs are wired through Expo config plugins (`app.json`), so they only
 * do anything in a NATIVE build — Expo Go cannot load them. That is why the
 * definition of done for T24 is a deliberate exception appearing in the Sentry
 * project from a dev-client build (T25-Android), not a green unit test.
 *
 * Everything is guarded on its key being present: a local run without a DSN
 * must be silent rather than crashing, and `getAnalytics()` must always return
 * a usable client so no caller has to ask whether analytics is ready.
 */
let analytics: AnalyticsClient = noopAnalytics;

/**
 * Init is idempotent on purpose. `initObservability` runs from a layout effect,
 * which React can invoke more than once (StrictMode, remounts); a
 * twice-initialised Sentry double-reports every crash and silently doubles the
 * denominator of crash-free sessions — an MVP baseline KPI.
 */
let initialised = false;

type JsonSafe = string | number | boolean | null;

/**
 * PostHog accepts only JSON values; `AnalyticsClient` passes `unknown`.
 *
 * Converting rather than casting: a cast would compile and then throw inside
 * the SDK on the first non-primitive, at runtime, on a user's device. Anything
 * that is not already a primitive is stringified, so an event is never lost to
 * a serialisation error.
 */
function jsonSafe(properties: Record<string, unknown>): Record<string, JsonSafe> {
  const out: Record<string, JsonSafe> = {};
  for (const [key, value] of Object.entries(properties)) {
    out[key] =
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
        ? value
        : JSON.stringify(value) ?? String(value);
  }
  return out;
}

export function initObservability(): void {
  if (initialised) return;

  const posthogKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!posthogKey && !sentryDsn) return;

  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      // Traces are off until there is a budget conversation; crash reporting is
      // what the KPI needs and it is the cheaper signal.
      tracesSampleRate: 0,
    });
  }

  if (posthogKey) {
    const posthog = new PostHog(posthogKey, {
      host: process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    });
    analytics = createAnalyticsClient({
      capture: (name, properties) => posthog.capture(name, jsonSafe(properties)),
      identify: (userId, traits) =>
        posthog.identify(userId, traits === undefined ? undefined : jsonSafe(traits)),
      reset: () => posthog.reset(),
    });
  }

  initialised = true;
}

/** The active analytics client — a no-op until `initObservability` wires one. */
export function getAnalytics(): AnalyticsClient {
  return analytics;
}
