// Flat ESLint config for the whole monorepo (Phase 3).
//
// Every package's `lint` script runs `eslint src` and resolves this root config.
// Kept intentionally lean: TypeScript correctness via typescript-eslint, plus a
// small set of project conventions. Type-aware rules are deliberately off here so
// lint stays fast and independent of `tsc` (typecheck is its own CI step).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    // Generated, built, and vendored output is never linted.
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.expo/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      'packages/types/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with `_`.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests may use non-null assertions and looser typing for fixtures.
    files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // §15: "No component imports `supabase-js` or calls `fetch` — enforced by
    // lint, not by convention." `packages/api-client` is the single path from
    // either app to the backend (AD-7), and this is what keeps it single.
    //
    // NOTE the rule names. §5 proposed banning `fetch` with
    // `no-restricted-imports`, which cannot work: `fetch` is a global and that
    // rule only inspects import declarations. `no-restricted-globals` is the
    // one that sees it.
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: [
      // The one legal home for both.
      'packages/api-client/**',
      // Tests stub `fetch` and mock supabase-js by name; that is how the
      // client is tested at all.
      '**/*.test.{ts,tsx}',
      // Deno, not a pnpm workspace, and outside `files` above in any case —
      // listed so the exception set is explicit rather than incidental.
      'supabase/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@supabase/*', '@supabase/*/**'],
              message:
                'Do not use supabase-js directly — use @planpal/api-client, which owns the session and the refresh-once-retry-once path.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'Do not call fetch directly — use @planpal/api-client, so auth headers, the ApiResult envelope and PlanPalApiError stay in one place.',
        },
      ],
    },
  },
);
