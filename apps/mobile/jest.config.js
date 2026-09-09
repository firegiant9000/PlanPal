/**
 * `jest-expo` — the workspace's THIRD test runner, and a deliberate exception.
 *
 * Decision D-H, answered 2026-09-08: Vitest cannot transform React Native's
 * untranspiled Flow sources, so component rendering on the platform that
 * matters most would otherwise stay untested — and Playwright cannot reach
 * mobile at all. See docs/TESTING.md.
 *
 * The `transformIgnorePatterns` below are the whole difficulty. This repo sets
 * `node-linker=hoisted` (Expo requires it), so every dependency resolves to
 * `<repo>/node_modules/...` rather than `apps/mobile/node_modules/...`. The
 * pattern is therefore written to match `node_modules/` anywhere in an
 * absolute path rather than assuming a nested layout.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx', '**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.expo/'],
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native(-.*)?|@react-native(-community)?/.*' +
      '|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*' +
      '|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-clone-referenced-element' +
      '|@sentry/react-native|@testing-library/react-native))',
  ],
};
