import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsClient, noopAnalytics } from './client';
import { ANALYTICS_EVENT_NAMES } from './events';

describe('noopAnalytics', () => {
  it('is always safe to call before init', () => {
    expect(() => {
      noopAnalytics.track('app_opened', { platform: 'web', cold_start: true });
      noopAnalytics.identify('u_1');
      noopAnalytics.reset();
    }).not.toThrow();
  });
});

describe('createAnalyticsClient', () => {
  it('forwards typed events to the underlying capture sink', () => {
    const capture = vi.fn();
    const client = createAnalyticsClient({ capture, identify: vi.fn(), reset: vi.fn() });

    client.track('screenshot_import_completed', {
      succeeded: true,
      events_extracted: 3,
      duration_ms: 1200,
    });

    expect(capture).toHaveBeenCalledWith('screenshot_import_completed', {
      succeeded: true,
      events_extracted: 3,
      duration_ms: 1200,
    });
  });
});

describe('ANALYTICS_EVENT_NAMES', () => {
  it('has no duplicates', () => {
    expect(new Set(ANALYTICS_EVENT_NAMES).size).toBe(ANALYTICS_EVENT_NAMES.length);
  });
});
