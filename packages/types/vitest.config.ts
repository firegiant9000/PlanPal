import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/generated/**'],
      // Deliberately NO thresholds here, unlike the other shared packages.
      // @planpal/types is almost entirely type declarations, which erase at
      // compile time: v8 reports 0% lines because there is no runtime code to
      // execute. A percentage bar would be a number with no meaning behind it.
      // The real gate for this package is `contract.yml`, which fails if the
      // generated types drift from openapi.yaml.
    },
  },
});
