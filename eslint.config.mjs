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
);
