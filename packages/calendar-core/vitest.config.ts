import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
      // docs/TESTING.md and §7 both put this package at >=90%. Set at creation,
      // not "later": the M2 review found that a documented-but-unenforced
      // threshold is worth exactly nothing, and every other package here that
      // acquired one acquired it after the fact.
      //
      // 90% is defensible because this code is pure — no I/O, no platform, no
      // mocking required. There is no excuse for an untested branch.
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
    },
  },
});
