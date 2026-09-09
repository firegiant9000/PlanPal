/* eslint-disable @typescript-eslint/no-require-imports --
 * `require` is deliberate and cannot be replaced here. Each test needs a FRESH
 * copy of the module so the `initialised` latch resets, which means
 * `jest.resetModules()` followed by a re-require. The ESM equivalent,
 * `await import()`, throws "A dynamic import callback was invoked without
 * --experimental-vm-modules" under jest-expo. Scoped to this file only.
 */

/**
 * Guards on the init path, not on the SDKs.
 *
 * Both native SDKs are mocked: this asserts that a missing key is silent and a
 * present key initialises exactly once. Whether Sentry actually receives an
 * event is a native-build question (T25-Android), and no unit test can answer
 * it — see T24's definition of done.
 *
 * The `mock` prefixes are required: jest hoists `jest.mock` factories above the
 * file, so only `mock*` variables may be referenced from inside them.
 */
const mockSentryInit = jest.fn();
const mockPosthogCtor = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: (...args: unknown[]) => mockSentryInit(...args),
}));
jest.mock('posthog-react-native', () => ({
  __esModule: true,
  default: class {
    constructor(...args: unknown[]) {
      mockPosthogCtor(...args);
    }
    capture() {}
    identify() {}
    reset() {}
  },
}));

describe('initObservability', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSentryInit.mockClear();
    mockPosthogCtor.mockClear();
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
  });

  it('initialises nothing and throws nothing when the DSN is absent', () => {
    const { initObservability, getAnalytics } = require('./observability');

    expect(() => initObservability()).not.toThrow();
    expect(mockSentryInit).not.toHaveBeenCalled();
    expect(mockPosthogCtor).not.toHaveBeenCalled();
    // Still a usable client, so callers never branch on "is analytics ready".
    expect(() => getAnalytics().track('event_created', { source: 'manual' })).not.toThrow();
  });

  it('initialises Sentry once when the DSN is present', () => {
    process.env.EXPO_PUBLIC_SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    const { initObservability } = require('./observability');

    initObservability();
    initObservability();

    // Twice-initialised Sentry double-reports every crash, which silently
    // doubles the crash-free-sessions denominator — an MVP baseline KPI.
    expect(mockSentryInit).toHaveBeenCalledTimes(1);
    expect(mockPosthogCtor).not.toHaveBeenCalled();
  });

  it('initialises PostHog only when its key is present', () => {
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
    const { initObservability } = require('./observability');

    initObservability();

    expect(mockPosthogCtor).toHaveBeenCalledTimes(1);
    expect(mockSentryInit).not.toHaveBeenCalled();
  });
});
