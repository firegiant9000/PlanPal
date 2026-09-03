# Test strategy (Phase 3)

> The roadmap warns that bugs in the recurrence engine and privacy redaction are
> the expensive ones. This defines the coverage bar **now**, before those bugs
> appear — not after.

## Test pyramid & targets

| Layer           | What it covers                                                                              | Tooling                                           | Where                           |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------- |
| **Unit**        | Pure logic: recurrence expansion, timezone math, redaction rules, token/contract invariants | Vitest (packages/apps) · `node:test` (recurrence) | `*.test.ts` beside source       |
| **Integration** | Edge Function routes against a real local Supabase (RLS, RPCs, triggers)                    | Vitest + Supabase CLI stack                       | `supabase/tests`                |
| **E2E**         | Critical user journeys (sign-up → create event → share)                                     | Playwright (web) · Detox/Maestro (mobile)         | added as real screens land (M3) |

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
scripts ran `vitest run` _without_ `--coverage`, so the numbers were never even
computed. Nothing could fail a PR for missing the bar.

| Package                                        | Gate                                        | Where                                                      |
| ---------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `@planpal/recurrence`                          | lines ≥ 90 · branches ≥ 85 · functions ≥ 90 | `node --test --test-coverage-*` flags in its `test` script |
| `@planpal/analytics`, `@planpal/design-tokens` | 70 across all four metrics                  | `coverage.thresholds` in `vitest.config.ts`                |
| `@planpal/types`                               | _(none — deliberate)_                       | see below                                                  |

`@planpal/types` has no threshold on purpose: it is almost entirely type
declarations, which erase at compile time, so v8 reports 0% lines. A percentage
there would be a number with nothing behind it. Its real gate is `contract.yml`,
which fails if the generated types drift from `openapi.yaml`.

Two caveats worth knowing:

- The recurrence gate needs Node's `--test-coverage-lines` family, added in Node 22. The repo pin moved from Node 20 to 22 for this (Node 20 is also past EOL).
- Node's coverage reporter **omits files no test ever loaded**, so an entirely
  untested module is invisible rather than reported as 0%. `row.ts` sat at zero
  coverage while the package reported 96%. When adding a module, add at least one
  test that imports it, or the gate cannot see it.

## Edge Functions (`supabase/functions`)

Deno, not Node — and _not_ a pnpm workspace, so `turbo run lint|typecheck|test`
cannot see it. Until the M2 review that meant the entire backend shipped with no
gate at all. `ci.yml`'s `edge-functions` job now runs `deno lint` + `deno check`
against `supabase/functions/deno.json`.

`deno check` proves a function compiles, never that it works. The runtime gate is
the integration suite in `supabase/tests` (below).

Recurrence logic must never be re-implemented inside a function. The functions
import a generated mirror of `packages/recurrence` (`pnpm recurrence:sync`), and
CI fails on drift via `pnpm recurrence:check`.

## Integration suite (`supabase/tests`)

Calls the Edge Functions over real HTTP against the local stack — no mocks, no
importing a handler directly. Users are created through the GoTrue admin API so
the `handle_new_user` trigger fires and the profile rows a real signup would
produce exist.

```bash
pnpm db:start           # required: the suite needs Postgres + the edge runtime
pnpm test:integration
```

It is **not** part of `pnpm test`. The package deliberately has no `test`
script, so `turbo run test` skips it and a contributor without Docker running
still gets a green local `pnpm test`. CI runs it as its own `integration` job,
which is the only job that starts a database — so it is also what proves the
migration chain applies from scratch.

**Adding a new Edge Function needs a stack restart, not just a file save.** The
edge runtime enumerates function directories once, when `supabase start` runs,
and passes that list to the container — so a brand-new `supabase/functions/<name>`
answers `Function not found` until you run `pnpm db:stop && pnpm db:start`.
Restarting the container alone is not enough; it reuses the same list.

Edits to an _existing_ function usually hot-reload, but **not reliably** — the
runtime can keep serving a cached isolate of the previous code, so a test fails
against a version of the handler you have already changed. If a change appears
not to have taken effect, `docker restart supabase_edge_runtime_planpal` before
debugging the code; it is much more often the isolate than the logic. The
giveaway is a log line proving a branch ran that no longer exists in the file.

CI is unaffected by both: its stack always starts fresh.

Two conventions worth keeping:

- **Each spec creates its own users** and deletes them in `afterAll`, rather
  than truncating shared tables. Specs stay independent without a global reset.
- **Encode a known defect with `it.fails`**, not a comment. It passes while the
  bug exists and starts failing the moment the bug is fixed, which forces the
  test to be promoted rather than left to rot. `contract-shape.test.ts` used
  this to hold the `POST /events` snake_case response until it was serialised
  properly; those are now ordinary assertions, which is how the pattern is
  meant to end.
- **Assert the shape of a failure, not just its absence.** An early version of
  the anon-access test coerced any non-array response to `[]`, so it passed on
  a `permission denied` error object and would have passed had anon been able
  to read everything. It now asserts the status and SQLSTATE.

## Running tests

```bash
pnpm test                         # every workspace with a `test` script (via Turbo)
pnpm test:integration             # Edge Functions vs the local stack (needs pnpm db:start)
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
