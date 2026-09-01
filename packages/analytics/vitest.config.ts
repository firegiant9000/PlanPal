import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      // docs/TESTING.md sets >=70% for shared packages. Documented but not
      // enforced until now: `vitest run` without --coverage never evaluated
      // thresholds, so nothing could fail a PR for missing the bar.
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
