import type { AnalyticsEventName, PropertiesOf } from './events';

/**
 * Platform-agnostic analytics surface. Each app implements this against its own
 * SDK (web: posthog-js; mobile: posthog-react-native) so call sites in shared
 * code depend on this contract, never on a concrete SDK.
 */
export interface AnalyticsClient {
  /** Capture a typed product event. */
  track<N extends AnalyticsEventName>(name: N, properties: PropertiesOf<N>): void;
  /** Associate subsequent events with a user (call after auth). */
  identify(userId: string, traits?: Record<string, unknown>): void;
  /** Clear the identified user (call on sign-out). */
  reset(): void;
}

/**
 * No-op client. Used as the default before init, in tests, and whenever the
 * PostHog key is absent (local dev / CI) so analytics calls are always safe.
 */
export const noopAnalytics: AnalyticsClient = {
  track: () => {},
  identify: () => {},
  reset: () => {},
};

/**
 * Wrap a raw `capture(name, props)` sink (the shape both PostHog SDKs expose)
 * in the typed {@link AnalyticsClient}. Keeps the SDK-specific glue in each app
 * to a few lines.
 */
export function createAnalyticsClient(sink: {
  capture: (name: string, properties: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
}): AnalyticsClient {
  return {
    track: (name, properties) => sink.capture(name, properties as Record<string, unknown>),
    identify: (userId, traits) => sink.identify(userId, traits),
    reset: () => sink.reset(),
  };
}
