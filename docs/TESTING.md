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
- **Default ≥ 70%** for other shared packages (`design-tokens`, `analytics`, `ui`).
- App UI (`web`, `mobile`) is covered by component + E2E tests rather than a line
  target; logic worth unit-testing belongs in a package.

**These targets are now enforced, not just documented.** Until the M2 review they
were aspirational: no `vitest.config.ts` set `coverage.thresholds`, and the `test`
scripts ran `vitest run` *without* `--coverage`, so the numbers were never even
computed. Nothing could fail a PR for missing the bar.

| Package | Gate | Where |
|---------|------|-------|
| `@planpal/recurrence` | lines ≥ 90 · branches ≥ 85 · functions ≥ 90 | `node --test --test-coverage-*` flags in its `test` script |
| `@planpal/analytics`, `@planpal/design-tokens` | 70 across all four metrics | `coverage.thresholds` in `vitest.config.ts` |
| `@planpal/types` | *(none — deliberate)* | see below |

`@planpal/types` has no threshold on purpose: it is almost entirely type
declarations, which erase at compile time, so v8 reports 0% lines. A percentage
there would be a number with nothing behind it. Its real gate is `contract.yml`,
which fails if the generated types drift from `openapi.yaml`.

Two caveats worth knowing:

- The recurrence gate needs Node's `--test-coverage-lines` family, added in Node
  22. The repo pin moved from Node 20 to 22 for this (Node 20 is also past EOL).
- Node's coverage reporter **omits files no test ever loaded**, so an entirely
  untested module is invisible rather than reported as 0%. `row.ts` sat at zero
  coverage while the package reported 96%. When adding a module, add at least one
  test that imports it, or the gate cannot see it.

## Edge Functions (`supabase/functions`)

Deno, not Node — and *not* a pnpm workspace, so `turbo run lint|typecheck|test`
cannot see it. Until the M2 review that meant the entire backend shipped with no
gate at all. `ci.yml`'s `edge-functions` job now runs `deno lint` + `deno check`
against `supabase/functions/deno.json`.

There is still **no runtime test** for the Edge Functions — that needs the local
Supabase stack and is tracked as M3 work. Treat `deno check` as a floor, not
coverage.

Recurrence logic must never be re-implemented inside a function. The functions
import a generated mirror of `packages/recurrence` (`pnpm recurrence:sync`), and
CI fails on drift via `pnpm recurrence:check`.

## Running tests

```bash
pnpm test                         # every workspace with a `test` script (via Turbo)
pnpm --filter @planpal/recurrence test
pnpm exec vitest --coverage       # coverage for the Vitest packages
pnpm recurrence:check             # Edge mirror of the recurrence engine is in sync
deno lint && deno check events/index.ts   # from supabase/functions
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
