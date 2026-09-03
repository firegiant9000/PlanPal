import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Every spec talks to one shared Postgres. Specs isolate themselves by
    // creating their own users rather than by truncating tables, but running
    // files in parallel still multiplies cold starts on the single edge-runtime
    // container and makes failures harder to read. Serial is fast enough.
    fileParallelism: false,
    // A cold Edge Function invocation on the local stack routinely takes
    // multiple seconds (observed ~2.5s upstream latency on first hit).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // No coverage thresholds here on purpose: this suite measures the Deno
    // functions, which run in another process entirely, so a v8 coverage number
    // collected in Node would describe the test harness and nothing else.
    // Its gate is that every route's happy path and its 4xx paths are exercised.
  },
});
