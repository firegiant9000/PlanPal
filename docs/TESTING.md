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

**The `notify-scheduler` spec needs a function secret, written before the stack
starts.** That handler refuses to run without `CRON_SECRET` — it answers `500
{"error":"Server misconfigured."}` — and the Edge runtime reads function
environment variables from `supabase/functions/.env` when `supabase start`
runs. So:

```bash
echo CRON_SECRET=test-cron-secret > supabase/functions/.env
pnpm db:stop && pnpm db:start    # a container restart will NOT pick this up
```

`.env*` is gitignored, so this file is never committed; CI writes it in the
`integration` job before `supabase start`. The tell that it was missed is the
scheduler spec failing with 500 `Server misconfigured.` rather than the 403 its
wrong-secret case expects — that 500 → 403 transition is the proof the file was
read. See [SECRETS.md](SECRETS.md) for what the value means in a real
environment.

**iCal real-world import is a manual check, not a suite assertion.** The
integration suite verifies RFC 5545 conformance (CRLF, 75-octet folding, TEXT
escaping, `TZID` on every local timestamp, `RRULE` passthrough, `EXDATE`,
`RECURRENCE-ID`), but it cannot verify that a third-party importer accepts the
file. `planpal-sample.ics` references `TZID=America/New_York` with no
`VTIMEZONE` component, which RFC 5545 §3.6.5 requires — Google tolerates a bare
IANA TZID, Outlook desktop and some Apple Calendar versions shift or reject. So
"RFC 5545 verified by test" is narrower than it reads, and T13 is not done until
an import into **both** Google Calendar and Outlook.com has been performed and
dated against a written-down expected occurrence set (task E4).

**The expected occurrence set, written down 2026-09-08 — before any import.** It
is recorded here rather than agreed afterwards, because a set you read off the
importer is not a prediction and cannot fail. `planpal-sample.ics` (regenerated
2026-09-08 against the current export handler; byte-identical to the 2026-09-03
copy apart from `UID`/`DTSTAMP`/`CREATED`/`LAST-MODIFIED`) must produce in
September, in `America/New_York`, exactly:

| Date           | Expected                          | Why                        |
| -------------- | --------------------------------- | -------------------------- |
| Mon 2026-09-07 | 09:00–09:30 "Weekly standup, …"   | `DTSTART` of the series    |
| Mon 2026-09-14 | **11:00–11:30** "Standup (moved)" | `RECURRENCE-ID` override   |
| Mon 2026-09-21 | **no event at all**               | `EXDATE`                   |
| Mon 2026-09-28 | 09:00–09:30 "Weekly standup, …"   | series continues unchanged |

Three occurrences, not four. Check specifically that 09-14 shows **11:00 and not
09:00** (the override applied) and that 09-21 is **empty rather than a 09:00
entry** (the cancellation applied) — those two are what a tolerant importer gets
wrong silently. A time shifted by a whole hour on any row means the bare `TZID`
was not honoured, and `VTIMEZONE` generation moves from M9 into this month.

**Google alone is not sufficient evidence.** It tolerates bare IANA TZIDs, so it
is the importer that proves least; Outlook.com is the one that can fail.

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

## Tooling note — three runners, and why the third is allowed

The workspace has **three** test runners. Two of them are a consolidation
target; the third is a deliberate, documented exception.

- **Vitest** — `types`, `design-tokens`, `analytics`, `calendar-core`,
  `api-client`, `apps/web` (jsdom + Testing Library, task H1) and the
  Edge Function integration suite in `supabase/tests`. ESM-native, zero-config
  with our TS setup, built-in coverage.
- **`node:test`** — `@planpal/recurrence` only (compiles to `dist/` then runs
  `node --test`), an independent backend-track choice. **Still a consolidation
  candidate:** standardise on Vitest unless the recurrence engine has a specific
  reason to stay, and that is the backend track's call to make.
- **`jest-expo`** — `apps/mobile` only. **Decision D-H, answered 2026-09-08.**

### Why `jest-expo` is the exception

Vitest cannot transform React Native's untranspiled Flow sources. The
alternative was Vitest scoped to `src/lib/**` and pure hooks, with the
`expo export` bundle gate standing in as the test — which leaves component
rendering untested on the platform that matters most, and Playwright cannot
reach React Native at all.

So `apps/mobile` renders components under `jest-expo`, and **nowhere else in the
workspace may add a Jest config.** The accepted cost is three coverage reports
and three watch modes; do not try to unify them.

Two configuration details, both found by watching them fail, recorded because
neither is guessable:

- **`jest-expo` must match the Expo SDK line.** `pnpm add -D jest-expo` installs
  `latest` (57.x), which fails against SDK 53 with
  `Cannot find module 'expo/src/async-require/messageSocket'`. It is pinned to
  `~53.0.0`, and `jest` with it to `~29.7.0`.
- **`render` from `@testing-library/react-native` 14 is async** and must be
  awaited, and its queries must be taken from the return value rather than the
  `screen` singleton — under `node-linker=hoisted` the singleton resolves to a
  different module instance and every query reports "`render` function has not
  been called".

## Conventions

- Co-locate tests with source as `*.test.ts`.
- Tests must not hit the network or a cloud Supabase project — use the local CLI
  stack (`pnpm db:start`) for integration tests.
- A bug fix lands with a regression test that fails without the fix.
