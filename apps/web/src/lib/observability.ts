'use client';

import * as Sentry from '@sentry/nextjs';
import posthog from 'posthog-js';
import { createAnalyticsClient, noopAnalytics, type AnalyticsClient } from '@planpal/analytics';

/**
 * Light, env-driven observability init (Phase 3). Reads the public keys already
 * defined in .env.example. Both integrations are no-ops when their key is absent
 * (local dev / CI), so nothing here can break a build or a keyless run.
 *
 * Deliberately minimal: error capture + product analytics only. Session replay,
 * source-map upload, and profiling are deferred (they need a Sentry auth token
 * and a release pipeline — a later DevOps step).
 */
let analytics: AnalyticsClient = noopAnalytics;
let initialized = false;

export function initObservability(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NEXT_PUBLIC_PLANPAL_ENV ?? 'dev',
      tracesSampleRate: 0.1,
    });
  }

  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (posthogKey) {
    posthog.init(posthogKey, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: true,
    });
    analytics = createAnalyticsClient({
      capture: (name, properties) => posthog.capture(name, properties),
      identify: (userId, traits) => posthog.identify(userId, traits),
      reset: () => posthog.reset(),
    });
  }
}

/** The active analytics client (no-op until {@link initObservability} runs with a key). */
export function getAnalytics(): AnalyticsClient {
  return analytics;
}
