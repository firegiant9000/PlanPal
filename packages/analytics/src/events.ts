/**
 * Typed product-analytics events — the single source of truth for what we track
 * across mobile and web. Defining them here (instead of stringly-typed
 * `capture('some_event', {...})` calls scattered through the apps) keeps event
 * names and property shapes consistent, which is what makes the KPI funnels in
 * docs/METRICS.md actually computable.
 *
 * Each event maps to a Month-1 KPI:
 *   - activation        → `signed_up` + `event_created`
 *   - parse success rate → `screenshot_import_*`
 *   - push delivery      → `push_*`
 * Retention (D7/D30) and crash-free sessions are derived in PostHog/Sentry from
 * `app_opened` + session data, not from a dedicated event.
 */

/** Discriminated union of every analytics event and its typed properties. */
export type AnalyticsEvent =
  | { name: 'app_opened'; properties: { platform: Platform; cold_start: boolean } }
  | { name: 'signed_up'; properties: { method: AuthMethod } }
  | { name: 'event_created'; properties: { source: EventSource; is_recurring: boolean } }
  | { name: 'screenshot_import_started'; properties: Record<string, never> }
  | {
      name: 'screenshot_import_completed';
      properties: { succeeded: boolean; events_extracted: number; duration_ms: number };
    }
  | { name: 'push_delivered'; properties: { category: PushCategory } }
  | { name: 'push_opened'; properties: { category: PushCategory } };

export type Platform = 'ios' | 'android' | 'web';
export type AuthMethod = 'email' | 'google' | 'apple';
export type EventSource = 'manual' | 'screenshot_import';
export type PushCategory = 'reminder' | 'friend_request' | 'friend_event';

/** Event name literal type — handy for allow-lists and dashboard config. */
export type AnalyticsEventName = AnalyticsEvent['name'];

/** Narrow an event name to its properties type. */
export type PropertiesOf<N extends AnalyticsEventName> = Extract<
  AnalyticsEvent,
  { name: N }
>['properties'];

/** Authoritative list of tracked event names (mirror this in PostHog). */
export const ANALYTICS_EVENT_NAMES = [
  'app_opened',
  'signed_up',
  'event_created',
  'screenshot_import_started',
  'screenshot_import_completed',
  'push_delivered',
  'push_opened',
] as const satisfies readonly AnalyticsEventName[];
