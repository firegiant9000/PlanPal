# Prompt — continue implementing the PlanPal Month 3/4 plan

Paste everything below the line into a fresh agent session in the PlanPal repository.

---

You are a senior engineer continuing work in `PlanPal`, a shared-calendar app. Turborepo + pnpm
monorepo, Expo/React Native mobile (`apps/mobile`), Next.js web (`apps/web`), Supabase backend
(Postgres 17 + Deno Edge Functions in `supabase/functions`). Two-person team: Arlo owns frontend,
Scott owns backend.

**A previous session completed tasks A1, A2, E0, E-W1, B1–B6, G1, C0, C1, C2, G2, F1, F2a, F2b, D1,
D2 and the local half of D3.** Your job is the rest.

## Read first, in this order

1. **`docs/prompts/IMPLEMENT_M3_M4.md`** — the original brief. Every rule in it is still binding:
   test-driven with recorded red runs, one command per shell call, no Claude attribution,
   forward-only migrations, `--end-of-line auto` Prettier only on files clean at HEAD, commit only
   when asked, stop and ask on a gated decision.
2. **`docs/M3_M4_IMPLEMENTATION_PLAN.md`** — the task list. Your source of truth for what to do.
3. **`docs/M3_M4_SPECS_PLAN.md`** — the evidence behind each recommendation.
4. The "State of the branch" section below, which supersedes the plan wherever they disagree.

## Working state

Branch `mobile-sdk53-pins`, cut from `month3-development` at `c6dd6c2`. **Nothing is committed.**
The whole of the completed work is uncommitted in the working tree, and
`supabase/functions/_shared/database.types.ts` and `contract-types.ts` are `git add`-ed (staged) so
their drift gates had a tracked baseline. Ask before committing.

Local stack is running with migrations applied and `supabase/functions/.env` present
(`CRON_SECRET=test-cron-secret`). If you restart it, that file must exist **before** `supabase start`.

Current gate status, all verified at the end of the last session:

| Gate | State |
| --- | --- |
| `pnpm lint` | 19/19 |
| `pnpm typecheck` | 18/18 |
| `pnpm test` | 14/14 |
| `pnpm build` | 10/10, incl. the mobile Android bundle |
| `pnpm test:integration` | **213 passed, 1 skipped (214)**, 14 files |
| `pnpm recurrence:check` | in sync |
| `deno check */index.ts` | 0 errors |
| `deno lint` (scoped to `supabase/functions`) | clean |

## Decisions already answered — do not re-ask

- **D-0**: wk 9 = week of Mon 2026-08-31.
- **E1**: keep `PATCH` → `EventOccurrence`. **E2**: declare the 503. **E3**: add `Health.version`.
  **E4**: do the `.ics` import now, twice. **E5**: accept the `delete_me()` grant.
- **CLI pin**: `supabase` CLI **2.117.0** (confirmed as `latest` on 2026-09-08).
- `@supabase/supabase-js` is pinned exact at **2.116.0** in both `packages/api-client` and the Edge
  Functions' `esm.sh` specifier. Keep them equal.

## Decisions still UNANSWERED — these gate tasks, so ask before starting them

- **D-H** — a second test runner for mobile. Plan recommends `jest-expo` as the one documented
  exception to the one-runner rule. **Gates H2.**
- **D-I** — does each dev have an Android handset? **Gates T25-Android and T26-FCM.**
- **Descope** — if Arlo's line overruns: T24 → H2 → T29 → T28, in that order; never P7's tests,
  never T30. **To be taken in wk 12, inside I1.**

## What is left, in plan order

### Immediately actionable (ungated)

1. **D3 — cloud half.** The local half is done and verified (see below). What remains is on
   `planpal-dev` (`dhsfivkumctnstziokmu`) and **needs the human's explicit go-ahead before any
   cloud write**: three `vault.create_secret` calls, `supabase secrets set CRON_SECRET=…`, then the
   three-layer soak over ten consecutive minutes. This resolves open hypotheses **#4** (does the
   cloud gateway accept `apikey` alone, as the local one does?) and **#5** (is `pg_net` even enabled
   on dev, and do any vault secrets exist?). If layer 2 returns 401, the same-day fallback is
   `[functions.notify-scheduler] verify_jwt = false` in `supabase/config.toml`; record which branch
   was taken.
2. **T30 — backup cadence and a tested restore.** Independent of everything, MVP gate #7, and the
   only gate criterion closable today. Involves a read-only `supabase db dump` of `planpal-dev` —
   also cloud, so also ask first. Note the plan's step 1: state the plan tier. Free tier has **no**
   automated backups, and if `planpal-dev` is free-tier that is itself a finding for I1.
3. **E4 — import `planpal-sample.ics` into Google Calendar and Outlook.com.** Entirely manual: two
   personal accounts, ~15 min each, screenshots. You can do the useful half — regenerate the sample
   and write down the expected occurrence set **before** importing (exactly three September
   occurrences: `2026-09-07 09:00–09:30`, `2026-09-14 11:00–11:30` moved, `2026-09-28 09:00–09:30`,
   and **no** event on `2026-09-21`) — then hand it to the human. `docs/TESTING.md` already carries
   the line recording that this is a manual check.
4. **T7 — auth screens, session persistence, route guards** (Arlo, 3 ideal days). Ungated; depends
   on B2, which is done. Build email/password first; leave the OAuth buttons wired but visibly
   disabled until T6.
5. **H1 — a real test runner for `apps/web`** (Vitest + jsdom + Testing Library). Ungated. Needs
   three installs; installs work in this workspace (proven repeatedly).
6. **T18 → T20 → H3 → T24 → T28 → T29 → H4**, per the plan's dependency graph.
7. **I1 — Month 4 readiness review and `docs/GATE_EVIDENCE.md`** (wk 12).

### Gated

- **H2** (needs D-H), **T25-Android** and **T26-FCM** (need D-I).

## State of the branch — where reality differs from the plan

Read this before trusting any plan statement about the current tree.

**Hypotheses resolved.** #1 `expo export` succeeds after the SDK 53 pins (bundle produced, 2.53 MB
`.hbc`). #2 `expo install --check` exits 1 on a mismatch. #6 the Edge runtime **does** read
`supabase/functions/.env` at `supabase start` — observed as a 500 → 403 transition, not inferred.
#7 the 401 the client meets is the gateway's, not the contract's — proven by mutating the client to
the naive rule and watching it fail against the real gateway. #9 the chunking splits a 3.3 KB
session into sub-2048-byte parts. #14 there were 22 casts plus one comment.
**Still open:** #3, #4, #5, #8 (React Native's `fetch` — needs a device), #10 (Mailpit's API shape),
#11, #12 (route paths, partially — `GET /events` is proven end to end), #13.

**Corrections to the plan, found by executing it.**

- **`pnpm --filter … test:integration -- <spec>` does not filter.** It runs the whole suite. Use
  `pnpm -C supabase/tests exec vitest run src/<name>.test.ts`.
- **The drift-gate watched-fail procedure in C2 and F2b does not work as written.** Both gates
  regenerate *before* diffing, so a hand-edit of the generated file is overwritten and the diff comes
  back clean. What they actually catch is a **source change that was not regenerated** — a migration
  for C2, a spec edit for F2b. That is how both were demonstrated.
- **G1's scratch-database backfill test is not possible as specified.** `core_schema.sql` references
  `auth.users`, which GoTrue owns, so a bare `create database` cannot host the chain. The backfill is
  instead replayed verbatim inside a `DO` block that rolls itself back via a private errcode.
- **`expo install --fix` does not remove caret ranges** — pnpm's `^` save-prefix re-adds them, so the
  fix silently undoes itself on the next install. The pins were hand-written to `~`/exact.
- **`apps/web/package.json` had to change.** Specs §A assumed React and TypeScript would move at the
  hoisted root; pnpm resolved per-workspace instead and produced **two** copies of `@types/react`,
  which broke `apps/web`'s typecheck. Web is now pinned to the same 19.0 line.
- **`docs/BOOTSTRAP.md`, `docs/TESTING.md` and `turbo.json` were Prettier-clean at HEAD**, so edits
  to them must be formatted. `IMPLEMENTATION_PLAN.md`, `docs/SECRETS.md`, `docs/ENVIRONMENTS.md`,
  `.env.example` and `eslint.config.mjs` were **not** — never run `--write` on those.
- **`deno lint` must be scoped**: `deno lint --config supabase/functions/deno.json supabase/functions`.
  Run at the repo root it reports 8 unrelated problems across 106 files.

**Open findings that need a decision — none of these are blocking, all are recorded in code.**

1. **The contract declares seven `Event` properties non-nullable that the schema permits to be
   NULL** (`title`, `localStart`, `localEnd`, `timezoneId`, `utcStart`, `utcEnd`, `visibility`), plus
   `Profile.birthday` and `Device.platform`. Surfaced by F2b; invisible while the models were
   hand-written. `toEventModel` now throws loudly rather than emitting a null through a non-nullable
   field. **The real fix is a `NOT NULL` migration or a contract change (two-dev, §15).** See the
   block comment at the top of `supabase/functions/_shared/serialize.ts`.
2. **`GET /events/{id}` does not filter `is_master`**, so an exception row's id would serialise
   through the `Event` shape. Same defect class as §11's override route. Not fixed; out of F2b's
   scope.
3. **Three fields were being emitted that the contract does not declare** — `masterEventId`,
   `recurrenceExceptionDate`, `isCancelled`. I stopped emitting them (§11 makes the spec the
   authority, and `DeviceModel` sets the precedent). **This is a wire change; reverting is three
   lines in `toEventModel`.** Confirm or reverse it.
4. **`/healthz` hangs rather than 503s when Postgres is reachable-but-wedged.** `docker pause` on the
   database leaves the probe with no response for 25 s+; there is no timeout on the `rpc()` call. An
   uptime checker sees a timeout, not a 503. Recorded in `docs/ENVIRONMENTS.md`.
5. **`pnpm install --frozen-lockfile` reports `-97` packages** relative to a plain `pnpm install`, so
   CI's tree is not byte-identical to a developer's. Pre-existing; every gate is green from the frozen
   tree, and the bundle hash is identical. Worth a ticket.
6. **F1's migration timestamp (`…09000001`) sorts before G1's (`…09000002`)**, which was applied
   first locally. Harmless — nothing is pushed, and `db:reset` replays in filename order — but do not
   push them out of order.

**D3 local half — what is already proven, so you need not redo it.**

`supabase/migrations/20260909000003_enable_notify_cron.sql` is written and applied. Locally, with the
three vault secrets created:

- layer 1 — `cron.job_run_details` `succeeded` for consecutive ticks;
- layer 2 — `net._http_response` `200` with `{"dispatched":0,"candidates":0}`;
- watched fail — a wrong `cron_secret` yields `net._http_response.status_code = 403`, then recovers;
- a **missing** secret yields `cron.job_run_details.status = 'failed'` with
  `null value in column "url" … violates not-null constraint`, and **nothing** in
  `net._http_response`. So a green `cron.job_run_details` is not evidence the tick worked — check
  both layers. This is documented in the migration's header.
- `pg_net.ttl` is **6 hours**, so `net._http_response` self-prunes; the plan's growth risk is bounded
  at roughly 360 rows.

**Layer 3 (a `notification_sends` row) cannot be verified locally or on dev with a fake Expo token.**
Expo answers `DeviceNotRegistered` and the `devices` row is pruned — confirmed by the tick log
`{"at":"notify-scheduler.tick","durationMs":375,"candidates":1,"dispatched":0,"deadTokens":1}`. Only
a real token from a T25-Android dev build proves delivery, which is MVP gate #3.

## Environment gotchas that cost time last session

- Docker must be running before `pnpm db:start`. Half-started tell: `FUNCTIONS_URL` missing from the
  start output.
- **After editing a handler, `docker restart supabase_edge_runtime_planpal`** — cached isolates.
  A brand-new function directory needs a full `pnpm db:stop && pnpm db:start`.
- Deno is not on PATH:
  `/c/Users/arlok/AppData/Local/Microsoft/WinGet/Packages/DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe/deno.exe`.
  Always `--config supabase/functions/deno.json`.
- `pnpm --filter` prints a spurious `No projects matched the filters` line and still runs.
- `query()` in `supabase/tests/src/db.ts` opens a connection per call, and a **multi-statement** SQL
  string makes `pg` return an array of results, so `.rows` is `undefined`. For anything needing
  session state (`set role`, `set_config`) or a transaction, use a single `DO $$ … $$` block.
- **The `notify-scheduler` dispatch window is `[floor(now/min)·min − 4min, floor(now/min)·min + 1min)`.**
  Seeding a reminder at "now + 30s" is a 50 % coin flip. Anchor relative to the next minute boundary.
- The local JWT secret is `super-secret-jwt-token-with-at-least-32-characters-long`.
- `gh` must have `firegiant9000` active. The GitHub MCP server failed to connect last session
  (`Authorization header is badly formatted`); `gh` on the CLI was not tried.

## Standard of proof

Unchanged, and it earned its keep: **five separate tests written last session passed vacuously on
first draft** — a round-trip assertion that survived removing the chunking, a quiet-hours test that
passed because the reminder was never due, a guard test that targeted a row whose flag already held
the value, a lint-rule test that passed with no rule configured, and a control query that could not
tell "RLS allowed it" from "running as superuser". Every absence assertion must be watched failing.

When a gate or migration is the deliverable, the red run is a **watched-fail procedure**, and it
still comes first.

## Start here

1. Read the three documents above.
2. Ask about **D-H** and **D-I** if you intend to reach H2 / T25-Android; otherwise start with the
   next ungated task in plan order.
3. Ask before **any** cloud write (D3's cloud half, T30's dump, E-W1's outstanding step 6 against
   `planpal-dev`).
4. Report after each task: what changed, the quoted red output and the quoted green output, the gates
   you ran, and every deviation.
