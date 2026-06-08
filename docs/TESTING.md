# Test strategy (Phase 3)

> The roadmap warns that bugs in the recurrence engine and privacy redaction are
> the expensive ones. This defines the coverage bar **now**, before those bugs
> appear — not after.

## Test pyramid & targets

| Layer | What it covers | Tooling | Where |
|-------|----------------|---------|-------|
| **Unit** | Pure logic: recurrence expansion, timezone math, redaction rules, token/contract invariants | Vitest (packages/apps) · `node:test` (recurrence) | `*.test.ts` beside source |
| **Integration** | API endpoints against a real local Supabase (RLS, RPCs, triggers) | Vitest + Supabase CLI stack | `apps/api` (lands with the API, post-Phase 1) |
| **E2E** | Critical user journeys (sign-up → create event → share) | Playwright (web) · Detox/Maestro (mobile) | added as real screens land (M3) |

**Coverage targets**

- **Mandatory ≥ 90% (lines + branches):** the recurrence engine (`@planpal/recurrence`)
  and privacy redaction (the friend-visibility / sensitive-public "Busy" logic,
  landing with the M2 RPCs). These are zero-tolerance areas — review requires the
  coverage report.
- **Default ≥ 70%** for other shared packages (`types`, `design-tokens`,
  `analytics`, `ui`).
- App UI (`web`, `mobile`) is covered by component + E2E tests rather than a line
  target; logic worth unit-testing belongs in a package.

## Running tests

```bash
pnpm test                         # every workspace with a `test` script (via Turbo)
pnpm --filter @planpal/recurrence test
pnpm exec vitest --coverage       # coverage for the Vitest packages
```

`pnpm test` runs in CI on every PR (`.github/workflows/ci.yml`), alongside `lint`,
`typecheck`, and `build`.

## Tooling note — two runners (to consolidate)

The workspace currently has **two** test runners:

- **Vitest** — used by `types`, `design-tokens`, `analytics`, and (going forward)
  the apps. ESM-native, zero-config with our TS setup, built-in coverage.
- **`node:test`** — used by `@planpal/recurrence` (compiles to `dist/` then runs
  `node --test`), an independent backend-track choice.

Both are green in CI today. **Decision for the team:** standardize on Vitest for
consistency (one coverage report, one watch mode) unless the recurrence engine has
a specific reason to stay on `node:test`. Flagged here rather than changed
unilaterally — `@planpal/recurrence` is owned by the backend track.

## Conventions

- Co-locate tests with source as `*.test.ts`.
- Tests must not hit the network or a cloud Supabase project — use the local CLI
  stack (`pnpm db:start`) for integration tests.
- A bug fix lands with a regression test that fails without the fix.
