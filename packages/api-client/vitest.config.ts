import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts'],
      // Set at creation, not "later" (§15). `packages/calendar-core` is the
      // precedent; it sits at 90 because it is pure maths.
      //
      // 70 here, per docs/TESTING.md's `api-client` row, because this layer
      // cannot be tested without mocking the network: the unit suite stubs
      // `fetch`, so it proves the client's own logic and nothing about the
      // gateway. The real 401 is proved separately, against the running stack,
      // in supabase/tests/src/api-client.test.ts (B6). A 90 threshold here
      // would buy coverage of stubs rather than confidence.
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
