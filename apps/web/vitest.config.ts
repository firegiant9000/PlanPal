import { defineConfig } from 'vitest/config';

/**
 * Component-test runner for `apps/web`.
 *
 * NO COVERAGE THRESHOLD, DELIBERATELY. docs/TESTING.md puts app UI behind
 * component + E2E tests rather than a line target: the shared packages carry
 * the coverage gates (90/70), because that is where the logic lives. A number
 * here with nothing behind it would be worse than none — it would be met by
 * rendering every component once and asserting nothing. Please do not "fix"
 * this by adding one; add a test instead.
 */
export default defineConfig({
  // The app's tsconfig sets `jsx: "preserve"` for Next's own compiler, which
  // leaves esbuild with untransformed JSX. Tests need it transformed.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
  },
});
