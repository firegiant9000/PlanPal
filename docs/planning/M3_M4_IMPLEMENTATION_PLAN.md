# PlanPal — Month 3/4 implementation plan

**Derived from:** [M3_M4_SPECS_PLAN.md](M3_M4_SPECS_PLAN.md) (the investigation of 2026-09-07). That
document is the source of truth for _why_; this one is the source of truth for _what to do next_.
Its recommendations are not re-litigated here — they are turned into tasks.
**Companions:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (§ references, AD-1..AD-11,
§15 standing rules), [MONTH_3_4_PLAN.md](MONTH_3_4_PLAN.md) (P references, the MVP exit gate),
PR #3's body (defect and decision numbering).
**Audience:** an engineer or agent who has never seen this repo. Every task names its files, its
tests, the exact commands that prove it, and what to revert if it is abandoned.

---

## Goal

Close the remaining Month 3 work and set up Month 4 so that the MVP exit gate in
`MONTH_3_4_PLAN.md` is reachable: the mobile app bundles and installs on both devs' phones, both
apps reach the backend through one typed client, the backend's remaining correctness gaps
(`birthday_flag`, generated DB types, the rotation lock, the contract-shape gate, live `pg_cron`)
are closed, and both apps have a test runner in CI.

## No week schedule — this plan is ordered, not dated

**Deliberately removed, 2026-09-08.** This document used to schedule every task as `wk N dM` against
an unanswered anchor ("wk 9 = week beginning **\_\_**"), which made the whole plan depend on a decision
nobody could settle: two readings were live and they differed by four weeks, one of which put the
build deadline in the past.

Rather than pick a date and pretend, the schedule is gone. **What survives is what actually
constrains the work:** the dependency order, the ideal-day estimates, and the descope order. Those
are properties of the task list and hold regardless of when anyone starts.

**So: no task below carries a start date, and no milestone carries a deadline.** If you need a
calendar, build it from § Critical path's dependency chain and the ideal-day column, against
whatever start date you actually choose — and put it somewhere it can be revised, not in here.

The two ordering facts worth keeping in mind:

- **Installable builds gate the dogfood window**, and the dogfood window needs 14 consecutive days.
  Whatever the start date, builds must land at least 14 days plus slack before the MVP gate.
- **Freeze precedes dogfooding.** T28 and T29 are either merged before it or descoped in writing.

## Start order

`A → E → B → G → C → F → D → H → I`, exactly as the specs plan sets it. Scott's chain (G, C, F, D,
plus T30 which has no dependencies at all) runs fully parallel to Arlo's chain
(A → B → T7 → T18 → T25-Android). Arlo's chain is the critical path. **B does not wait on T6**
(Google OAuth): email/password already works on the cloud project and the client needs no OAuth.

## What "done" means for this whole plan

Two conditions, both from specs §I. They are stated as an order, not as dates.

**Milestone 1 — installable builds.** Both devs have the dev-client APK installed and signed in, and
`devices` has a row per phone. `notify-scheduler` is scheduled on the environment the phones point
at, with D's layer 1–3 SQL checks green. T18 is done: real occurrences, create, override and cancel
from the phone. The T30 restore rehearsal is completed and dated.

**Milestone 2 — freeze.** T28 and T29 are merged, or explicitly descoped in writing (see the
capacity note below). Freeze is declared in writing. The dogfood log has entries from both devs, and
it started early enough to reach 14 consecutive days before the gate. Stage 1 Playwright and both app
test runners are green in CI. Tester recruiting is under way.

## Capacity note — read before committing to any dates

Arlo's ideal days in this plan total **24** (A 1 · B 3 · T7 3 · T18 2 · T25-Android 1.5 · T20 4 ·
H1 0.5 · H2 1 · H3 1.5 · T24 1 · T28 3 · T29 2.5). Against a five-week run that is **25 working days,
or about 18.75 after the plan's own 20–30 % non-feature reserve** — so the task list overruns a
five-week window by roughly a week on Arlo's line.

This is an arithmetic property of the task list, not of any start date, which is why it survives the
removal of the week schedule. Whatever window you pick, compare it against 24 ideal days and about a
25 % reserve before committing.

None of T28, T29, T24 or H2 is an MVP gate criterion. The gate needs CRUD stability, the recurrence
suite, push on real devices, the 14-day dogfood log, ten testers, an empty critical/high queue and a
dated restore. **So the descope, if one is needed, is T28/T29/T24/H2 — in that order — and it is a
decision to take deliberately, early, rather than discover at freeze.** Recorded as a risk on each of
those tasks, and as an explicit checkpoint in I1.

## Standing rules every task below complies with (§15)

- Recurrence is implemented once (AD-1). Anything else consumes the generated mirror; never write
  recurrence logic inside an Edge Function.
- Every new `SECURITY DEFINER` function ships with `revoke execute from public, anon, authenticated`
  **in the same migration**.
- Every new endpoint lands with an integration test **in the same PR**.
- Every new shared package sets coverage thresholds **when it is created**, not later.
- A contract change is a **two-dev decision**, and the regenerated types are committed with it.
- No component imports `supabase-js` or calls `fetch` — enforced by lint (task B5), not convention.
- Migrations are **forward-only**. Never edit one that has been applied anywhere; fix forward.

## Environment facts this plan relies on (verified 2026-09-07/08)

- Local stack is free and is the only environment tests may target: `pnpm db:start`,
  `pnpm db:reset`, `pnpm test:integration`, `docker exec supabase_db_planpal psql -U postgres`.
- Postgres 17 (`supabase/config.toml` `major_version = 17`); local project id is `planpal`, so
  container names are `supabase_db_planpal`, `supabase_edge_runtime_planpal`, `supabase_kong_planpal`.
- Docker must be running before `pnpm db:start`. Half-started-stack tell: `FUNCTIONS_URL` missing
  from the start output and ~136 test failures whose body is `{"message":"An unexpected error
occurred"}` (runtime shape, not the app envelope). Fix: `pnpm db:stop` then `pnpm db:start`.
- The edge runtime serves **cached isolates**. After editing a handler,
  `docker restart supabase_edge_runtime_planpal` before debugging the code. A brand-new function
  directory needs a full `pnpm db:stop && pnpm db:start` — restarting the container reuses the old
  directory list.
- Deno is not on PATH. Binary:
  `/c/Users/arlok/AppData/Local/Microsoft/WinGet/Packages/DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe`.
  Always `deno check --config supabase/functions/deno.json <file>`.
- `gh` must have `firegiant9000` active, or git/PR operations fail with "Repository not found"
  (`gh auth switch --hostname github.com --user firegiant9000`).
- The repo is a CRLF checkout and is **not** Prettier-clean. Only ever run
  `prettier --write --end-of-line auto` on files that were already clean at HEAD, and **never** on
  `supabase/functions/_shared/recurrence/*` (generated; `pnpm recurrence:check` fails on byte drift).
- `pnpm --filter` prints a spurious `No projects matched the filters` line while still running.
  Ignore it.
- The local stack's JWT secret is the CLI demo value
  `super-secret-jwt-token-with-at-least-32-characters-long` — used in B6 to mint an expired token.
- **The session tool policy previously refused `pnpm add` into this workspace.** Task A1 is the
  first task that needs a dependency install, so it doubles as the probe for that. If an install is
  refused, **stop at that step and ask** — do not work around it. Tasks A1, B2, H1, H2, H3, T24 and
  T25-Android all need installs and are all blocked by the same refusal.

## The standard of proof

Every Month 2 and Month 3 defect listed in PR #3 was in code that linted, type-checked and had
passing tests. A claim you have not executed is a **hypothesis** and must be labelled as one. Gates
that have never failed are unproven: where a task's deliverable is a gate or a migration, "the test"
is the **watched-fail procedure** written out in that task's steps.

---

# Blocking decision checkpoints

These need a human, not a plan step. Each carries the specs plan's recommended answer and the tasks
it gates. **A gated task does not start until its decision is answered in writing** (a PR comment, a
line in `MONTH_3_4_PLAN.md`, or a reply in the thread that dispatched the work). While blocked, move
to the next ungated task rather than guessing.

**D-0 (the week anchor) is gone** — the week schedule it existed to anchor was removed on
2026-09-08. See § No week schedule.

| ID          | Question                                                     | Recommended answer (specs plan)                              | Gates                        | Status (2026-09-08)                      |
| ----------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------- | ---------------------------------------- |
| **E1**      | Occurrence override route stays `PATCH` → `EventOccurrence`? | Keep. Sign off on PR #3 item 1                               | PR #3 merge                  | **Answered: keep**                       |
| **E2**      | Declare `/healthz`'s 503?                                    | Declare it, with the `ApiError` envelope                     | E-W1                         | **Answered: declare**                    |
| **E3**      | Add `Health.version`?                                        | Add, injected from `$GITHUB_SHA`                             | E-W1                         | **Answered: add**                        |
| **E4**      | Do the real Google/Outlook `.ics` import for T13?            | Do it now, twice. `VTIMEZONE` moves up only if Outlook fails | T13 being marked done        | Answered: do it. **Imports outstanding** |
| **E5**      | `delete_me()` keeps `EXECUTE` for `authenticated`?           | Accept, and amend §15 with the no-target-parameter exception | PR #3 merge                  | **Answered: accept**                     |
| **CLI-pin** | Which exact `supabase` CLI version do we pin?                | **2.117.0** (verified as `latest` on 2026-09-08)             | C0, and therefore C2 and F2b | **Answered: 2.117.0**                    |
| **D-H**     | Mobile test runner — a second runner (`jest-expo`)?          | `jest-expo`, as the one documented exception                 | H2                           | **Answered: yes.** H2 done               |
| **D-I**     | Does each dev have a physical Android phone?                 | Confirm, or record the Apple block on gates #3 and #4        | T25-Android, T26-FCM         | **OPEN — "unsure"**                      |
| **Descope** | If Arlo's line overruns, what gives?                         | T24, then H2, then T29, then T28 — never P7 tests or T30     | T28, T29, T24, H2            | Not needed — all four are built          |

---

# Task A1 — Align `apps/mobile` to the Expo SDK 53 pins

**Implements:** specs §A, option 2 · **Owner:** Arlo · **Ideal days:** 0.5 · **Gated on:** nothing
**Blocks:** A2, T18, T23-mobile, T24, T25-Android, T26, T29, P10 dogfooding — therefore gates #3 and #4.

Metro cannot produce a JS bundle for the mobile app. `react-native-screens@4.25.2` declares
`peerDependencies.react-native: ">=0.82.0"` and its Fabric spec files type events as
`CT.DirectEventHandler<…>` from a `CodegenTypes` export that `react-native@0.79.7` does not have;
`@react-native/codegen`'s TypeScript parser then throws
`Unknown prop type for "onAppear": "undefined"`. Six other packages are also off the SDK 53 pins.
The caret ranges in `apps/mobile/package.json` are the root cause class — `^4.0.0` resolved to a
post-SDK-53 release from the repo's first lockfile onward.

**This is the first task in the plan that installs a dependency.** If the tool policy refuses the
install, **stop and ask**: A2, B2, H1, H2, H3, T24 and T25-Android are all blocked by the same
refusal, and there is no workaround worth having.

**Files**

- Modify `apps/mobile/package.json` — seven dependency ranges rewritten by `expo install --fix` to
  the SDK 53 pins; carets on native modules replaced with `~`/exact as `expo install` writes them.
- Modify `pnpm-lock.yaml` — regenerated. Expect `react`, `react-dom`, `@types/react` and
  `typescript` to move at the hoisted root, so `apps/web` sees them too.
- Modify `apps/web/package.json` — only if `expo install`'s React/TypeScript pins conflict with the
  declared ranges there; prefer leaving it alone and letting the root resolution settle.

**Steps**

1. Write the failing test. Create `apps/mobile/deps.test.ts` with
   `it('pins every native-module dependency without a caret range')`: read
   `apps/mobile/package.json`, take every `dependencies` key matching `expo`, `expo-*`,
   `react-native` or `react-native-*`, and assert none of their version strings starts with `^`.
2. Run it and record the red run:
   `pnpm --dir apps/mobile exec vitest run deps.test.ts`. Expected failure — the assertion lists
   `expo ^53.0.0`, `expo-router ^5.0.0`, `expo-status-bar ^2.0.0`, `react-native ^0.79.0`,
   `react-native-safe-area-context ^5.0.0`, `react-native-screens ^4.0.0`. Paste the output.
   _(`apps/mobile` has no `test` script yet — H1/H2 add it. Until then run Vitest through the root
   binary as above; the file stays and H2 wires it into the mobile runner.)_
3. Make the change: `CI=1 pnpm --dir apps/mobile exec expo install --fix`. Then
   `pnpm install` at the repo root to settle the lockfile.
4. Run the test again and record it passing.
5. Run the surrounding gates, all from the repo root, and paste each:
   - `pnpm --dir apps/mobile exec expo install --check` — must print no outdated dependencies and
     exit 0.
   - `CI=1 pnpm --dir apps/mobile exec expo export --platform android --output-dir dist-probe` —
     must exit 0 and write `dist-probe/_expo/static/js/android/*.hbc` (or `.js`). **This is the
     hypothesis the specs plan could not test** (the install was refused there); it is confirmed or
     refuted here. Delete `dist-probe` afterwards.
   - `pnpm lint`, `pnpm typecheck`, `pnpm build` — all three, because React and TypeScript moved
     under `apps/web` too. `next build` must stay green.
   - `pnpm test`.
6. Commit as **commit 1 of A's single PR**. Do not add the CI gate in this commit — A2 explains why.

**Definition of done** (specs §A, made concrete)

- `pnpm --dir apps/mobile exec expo install --check` exits 0 with no outdated dependencies.
- `CI=1 pnpm --dir apps/mobile exec expo export --platform android --output-dir dist` exits 0 and
  `apps/mobile/dist/_expo/static/js/android/` contains at least one `.hbc` or `.js` bundle.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green (run separately, one command
  per invocation).
- The app launches on an Android emulator or handset with no red-box. **This is a separate check
  from the bundle**, and it is the only thing that catches a React 19.2 renderer against an RN 0.79
  reconciler; the bundle gate cannot see it. If no device is available yet, record this bullet as
  outstanding and close it in T25-Android — do not mark A1 done silently.

**Rollback**

`git revert` the commit and run `pnpm install`. `pnpm-lock.yaml` returns to pinning
`react-native-screens@4.25.2` and the app returns to not bundling. Nothing else in the repo depends
on the new pins, so there is no forward-migration concern. Delete `apps/mobile/dist-probe` and
`apps/mobile/dist` if either survived.

**Risks that make it slip**

- `@types/react@19.0.10` may change typings `apps/web` relies on — `pnpm typecheck` is the detector,
  and the fix is per-site, not a re-pin.
- `typescript ~5.8.3` may disagree with `typescript-eslint@8.11` — `pnpm lint` is the detector.
- The tool-policy refusal on `pnpm add`/`expo install` (see above) blocks the whole task.
- The emulator/device check needs an Android handset, which is Decision D-I's subject.

---

# Task A2 — Gate the mobile bundle in CI

**Implements:** specs §A, "CI gate, and the sequencing that keeps CI green" · **Owner:** Arlo
**Ideal days:** 0.5 · **Gated on:** nothing · **Depends on:** A1 landing first, in the same PR.

Nothing in CI bundles either app: `apps/mobile` has no `build` or `test` script, so `turbo run build`
skips it, and `tsc` under `moduleResolution: "Bundler"` does not exercise Metro's transform. That is
how PR #3's defect 10 shipped. **The gate cannot land before the fix or `verify` goes red
immediately — so this is commit 2 of A1's PR, not its own PR.**

**Files**

- Modify `apps/mobile/package.json` — add
  `"build": "expo export --platform android --output-dir dist"`. `turbo.json` already lists
  `dist/**` under the `build` task's outputs and `.gitignore` already covers it, so no change is
  needed in either.
- Modify `.github/workflows/ci.yml` — in the `verify` job, after the `Build` step, add a step
  `Mobile dependency pins match the Expo SDK` running
  `pnpm --dir apps/mobile exec expo install --check`.

**Steps**

1. The "test" here is a **gate demonstration**, so the red run comes first and is recorded, not
   written as an `it(...)`. Establish the baseline: `git rev-parse HEAD~1` (A1's parent) and note the
   SHA.
2. Record the red run. Do it in a throwaway worktree rather than by stashing — the `build` script
   and the dependency pins live in the same file, so they cannot be separated with `git stash`.
   Run `git worktree add ../planpal-prefix <A1's parent SHA>`, then in that worktree apply only the
   two changes from this task's Files list by hand, `pnpm install`, and run both gate commands:
   - `CI=1 pnpm --dir apps/mobile exec expo export --platform android --output-dir dist` →
     expected failure `Android Bundling failed … react-native-screens/src/fabric/…: Unknown prop
type for "onAppear": "undefined"` (the exact file may differ — Metro transforms in parallel
     workers, so `SearchBarNativeComponent.ts` / `onSearchFocus` is the same failure).
   - `pnpm --dir apps/mobile exec expo install --check` → expected `Found outdated dependencies`
     and **exit code 1** (verified 2026-09-08: it exits 1 and lists the same seven packages, so no
     `grep`-the-output fallback is required — the specs plan flagged this as a hypothesis).
   - Paste both outputs into the PR body under "watched fail", then `git worktree remove ../planpal-prefix`.
3. Make the change on the branch: add the `build` script and the `ci.yml` step.
4. Run the gate green on the fixed tree, and paste:
   - `pnpm build` from the repo root — Turbo must now list `@planpal/mobile#build` and it must exit 0.
   - `pnpm --dir apps/mobile exec expo install --check` — exit 0.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`. `prettier --check --end-of-line auto
.github/workflows/ci.yml apps/mobile/package.json` — reformat only if both files were already
   Prettier-clean at HEAD.
6. Commit as **commit 2**, open the PR with both commits, and link the recorded red run in the body.

**Definition of done**

- `pnpm build` from a clean clone produces `apps/mobile/dist/_expo/static/js/android/*.hbc` (or
  `.js`) and exits 0.
- The PR's `verify` job log shows both the mobile export step and the `expo install --check` step.
- The PR body contains the pasted red output from step 2, against A1's parent commit. A gate that
  has never failed is unproven.
- `apps/mobile/deps.test.ts` (from A1) is green.

**Rollback**

Revert commit 2 only. The `build` script and the `ci.yml` step are additive and independent; removing
them returns CI to its current blindness without touching A1's fix. If instead the whole PR is
abandoned, revert both commits and run `pnpm install`.

**Risks that make it slip**

- CI wall-clock: local bundling took 13 s, so expect roughly a minute added to `verify`. If the
  `verify` job approaches its practical limit, move the export into its own job rather than dropping
  the gate.
- The Expo CLI needs to resolve packages in CI; `pnpm install --frozen-lockfile` runs first in
  `verify`, so this should hold, but a hoisting difference on Linux is the thing to watch.
- Creating a git worktree for the red run needs disk and a clean index. If worktrees are unavailable,
  the fallback is a scratch branch off A1's parent — never `--no-verify` and never skipping the red run.

---

# Task E0 — Record the PR #3 decisions and amend §15

**Implements:** specs §E1 and §E5 · **Owner:** both (Scott signs) · **Ideal days:** 0.25
**Gated on:** E1, E5 · **Blocks:** merging PR #3.

Thirty minutes of human decision, plus two small documentation edits. **PR #3 must not merge before
E1 and E5 are acknowledged in writing on the PR.** E2, E3 and E4 can be ticketed and are tasks
E-W1 and E4 below.

**Files**

- Modify `IMPLEMENTATION_PLAN.md` §11 — the 🔸 marker on the occurrence override route becomes ✅
  with the sign-off date.
- Modify `IMPLEMENTATION_PLAN.md` §15 — amend the `SECURITY DEFINER` bullet to read: "Every
  `SECURITY DEFINER` function ships with `revoke execute from public, anon, authenticated` in the
  same migration — **unless the function takes no target parameter and derives its subject from
  `auth.uid()`; every such exception is listed in `grants.test.ts` with its justification.**"

**Steps**

1. Scott comments "agreed" on PR #3 item 1 (keep `PATCH` → `EventOccurrence`) and on item 5
   (`delete_me()` keeps `EXECUTE` for `authenticated`). No code changes for either — both are
   already implemented that way, and `supabase/tests/src/grants.test.ts` already carries the
   allowlist entry `'public.delete_me() -> authenticated'` plus a staleness assertion.
2. Make the two documentation edits above.
3. Run `pnpm --filter @planpal/integration-tests test:integration -- grants` and paste the output —
   it must stay green, which is the evidence that the amended rule describes what is actually
   enforced rather than an aspiration.
4. `prettier --check --end-of-line auto IMPLEMENTATION_PLAN.md`; format only if it was clean at HEAD.

**Definition of done**

- PR #3 carries Scott's explicit written agreement on items 1 and 5.
- `IMPLEMENTATION_PLAN.md` §11's override-route marker is ✅ with a date; §15's bullet carries the
  no-target-parameter exception.
- `grants.test.ts` green, and `Object.keys(ALLOWED_END_USER_SECDEF)` still has length 1 (its own
  assertion).

**Rollback**

Revert the documentation commit. Nothing executable changes, so there is no migration or gate to
unwind. If E1 is answered the other way (revert to `PUT`/`Event`), that is a contract change and a
new task, not a rollback of this one — and the null-through-non-nullable problem has to be solved
either way.

**Risks that make it slip**

- Waiting on Scott. This is the cheapest blocker in the plan and the one most likely to sit.
- If E5 is answered "revoke it", `DELETE /me` is dead on arrival and T14 reopens as a
  service-role-admin design — a genuine multi-day reversal, already rejected in §6 and §14 #2.

---

# Task E-W1 — Declare `/healthz`'s 503 and add `Health.version`

**Implements:** specs §E2 and §E3 · **Owner:** Scott · **Ideal days:** 0.5
**Gated on:** E2, E3 (both are contract changes, so §15's two-dev sign-off applies).

`GET /healthz` returns `err('INTERNAL_ERROR', …, 503)` when the `rpc('healthz')` round-trip fails,
but `openapi.yaml` declares only `200` — every generated client sees a status the spec says cannot
happen. Separately, §6 describes a `version` string that `Health` does not declare, so the handler
deliberately omits it. Both are closed together because both are edits to the same schema and the
same handler, and `contract.yml` has to regenerate once either way.

**Files**

- Modify `packages/api-contract/openapi.yaml` — under `/healthz` `responses`, add `'503'` with
  `$ref: '#/components/responses/…'` for the `ApiError` envelope (match the shape the other paths
  use for their error responses); under `components.schemas.Health`, add `version: {type: string}`
  and add it to `required`.
- Modify `packages/types/src/generated/openapi.ts` — regenerated, committed with the change (§15).
- Modify `supabase/functions/healthz/index.ts` — `ok({ status: 'ok', version })` where
  `version = Deno.env.get('PLANPAL_VERSION') ?? 'unknown'`, read once per isolate beside the
  existing module-level client. Update the comment at lines 47–51, which currently explains why
  `version` is absent.
- Modify `.github/workflows/deploy-staging.yml` — add
  `npx --yes supabase@latest secrets set PLANPAL_VERSION=$GITHUB_SHA --project-ref "$PROJECT_REF"`
  before the `Deploy Edge Functions` step, and extend the `Smoke-check /healthz` step to assert the
  returned `version` equals `$GITHUB_SHA`.
- Create `supabase/tests/src/healthz.test.ts` — the integration test (§15: every endpoint change
  lands with one).

**Steps**

1. Write the failing test. `supabase/tests/src/healthz.test.ts`:
   - `it('returns ok with a version string')` — `callFn('healthz', { token: ANON_KEY })`, expect
     status 200, `body.ok === true`, `data.status === 'ok'`, and `typeof data.version === 'string'`
     with non-zero length.
   - `it('declares every status it can return')` — read `packages/api-contract/openapi.yaml`, assert
     `paths['/healthz'].get.responses` has both `'200'` and `'503'` keys. This is the assertion that
     stops the contract drifting back.
2. Run it and record the red run:
   `pnpm --filter @planpal/integration-tests test:integration -- healthz`. Expected two failures:
   `expected undefined to be a string` on `data.version`, and
   `expected { '200': … } to have property '503'`.
3. Make the changes: edit `openapi.yaml`, run `pnpm contract:generate`, edit the handler, edit
   `deploy-staging.yml`.
4. `docker restart supabase_edge_runtime_planpal` (cached isolate — the handler changed), then
   re-run step 2's command and record it passing.
5. Run the surrounding gates and paste each:
   - `pnpm --filter @planpal/api-contract validate`
   - `pnpm contract:generate` then `git diff --exit-code -- packages/types/src/generated` — must be
     clean, which is what `contract.yml` asserts.
   - `deno check --config supabase/functions/deno.json healthz/index.ts` (from
     `supabase/functions`, using the Deno path in the environment section).
   - `pnpm typecheck`, `pnpm test`.
   - `pnpm test:integration` in full — 195 tests plus the new ones.
6. Watched fail for the deploy assertion, once, by hand: set the secret to a wrong value
   (`supabase secrets set PLANPAL_VERSION=deadbeef --project-ref <dev ref>`), re-run the smoke curl
   from the workflow against dev, and record that the version comparison fails. Then set it back.
   This turns the smoke step from "something answered" into "the thing I just deployed answered".

**Definition of done**

- `curl -H "apikey: <anon>" https://<ref>.supabase.co/functions/v1/healthz` returns
  `{"ok":true,"data":{"status":"ok","version":"<sha>"}}` where `<sha>` equals
  `git rev-parse HEAD` of the deployed commit.
- The pasted red run from step 6 proves the smoke step fails on a version mismatch.
- `contract.yml` green with the new 503 response and the new required property.
- `healthz.test.ts` in the suite and green; `pnpm test:integration` green in full.
- A runbook line in `docs/ENVIRONMENTS.md` says how to observe the 503 locally: `docker pause
supabase_db_planpal`, `curl` the local `healthz`, `docker unpause`. Inducing that inside the suite
  is not worth the container gymnastics.

**Rollback**

Revert the commit and run `pnpm contract:generate` to confirm the generated types return to the
pre-change bytes. No migration is involved. On the deploy side, `supabase secrets unset
PLANPAL_VERSION` per environment; the handler's `?? 'unknown'` fallback means an unset secret
degrades rather than 500s — which is deliberate, so the rollback is safe in either order.

**Risks that make it slip**

- Making `version` **required** in `Health` is a breaking change for any client already generated
  against the old schema. There are none outside this repo today, which is exactly why it is cheap
  to do now rather than later; say so in the PR.
- `deploy-staging.yml`'s steps only run when the staging secrets are configured. The version
  assertion is therefore unexercised until T2 completes — verify it against **dev** by hand (step 6)
  rather than assuming the workflow proves it.

---

# Task E4 — Import the exported `.ics` into two real calendars

**Implements:** specs §E4 · **Owner:** Scott · **Ideal days:** 0.25 · **Gated on:** E4.
**Does not block code.** It blocks marking T13 done, and it decides whether `VTIMEZONE` moves from
M9 into this month.

T13's DoD reads "`.ics` imports into Google Calendar" and no import has been performed. RFC 5545
conformance _is_ covered by test (CRLF, 75-octet folding, TEXT escaping, `TZID` on every local
timestamp, `RRULE` passthrough, `EXDATE`, `RECURRENCE-ID`) — but `planpal-sample.ics` references
`TZID=America/New_York` with **no `VTIMEZONE` component**, which RFC 5545 §3.6.5 requires for every
referenced TZID. Google tolerates bare IANA TZIDs; Outlook desktop and some Apple Calendar versions
shift or reject. So "RFC 5545 verified by test" is narrower than it reads.

**Files**

- No source files. Modify `docs/TESTING.md` — one line under the integration-suite section recording
  that iCal real-world import is a manual check with a dated result, not a suite assertion.
- Attach evidence to the T13 ticket / PR #3 thread.

**Steps**

1. There is no failing test to write: the deliverable is externally observed behaviour in two
   third-party importers. The equivalent of the red run is the **expected occurrence set**, written
   down _before_ importing, so the check cannot be rationalised afterwards. From
   `planpal-sample.ics` (verified with ical.js 2.x): exactly three September occurrences —
   `2026-09-07 09:00–09:30`, `2026-09-14 11:00–11:30` (the override, moved), `2026-09-28 09:00–09:30`
   — and **no event on 2026-09-21** (the `EXDATE`).
2. Import into Google Calendar with a personal account. Record the three occurrences and the absent
   date, with a screenshot or an exported list.
3. Import into Outlook.com with a personal account. Record the same.
4. Compare against step 1. If either importer shifts the times, `VTIMEZONE` generation moves from M9
   to now — open it as a new task (1 day, needs tzdata rules in Deno) and say so in the ticket. If
   both match, record that `VTIMEZONE` stays in M9 with the evidence that justified deferring it.
5. Add the `docs/TESTING.md` line and commit that alone.

**Definition of done**

- Screenshots or an exported occurrence list from **both** importers attached to the T13 ticket.
- T13 is marked done only if both match the expected set from step 1. A Google-only pass is not
  sufficient — Google is the tolerant importer, so it is the one that proves least.
- A written decision on `VTIMEZONE`: deferred to M9 with evidence, or promoted with a task.

**Rollback**

Nothing to roll back beyond reverting the one documentation line. If the imports fail, the outcome is
a new task, not a revert.

**Risks that make it slip**

- Needs two personal calendar accounts and 15 minutes each. Cheap, but it is human time and it
  cannot be delegated to CI.
- `planpal-sample.ics` is gitignored and lives at the repo root. If it is missing, regenerate it:
  create a weekly master, override one occurrence to 11:00, cancel 2026-09-21, then
  `curl -H "Authorization: Bearer <token>" -H "apikey: <anon>"
'http://127.0.0.1:54321/functions/v1/export/ical' -o planpal-sample.ics`.

---

# Task B1 — Create `packages/api-client` with the transport and error layers

**Implements:** specs §B, option 1 (hand-rolled `http.ts` over `fetch`) · §5, AD-7, AD-8
**Owner:** Arlo · **Ideal days:** 1 · **Gated on:** nothing.
**Blocks:** B2–B6, T7, T18, T19, T20, T29.

The single path from either app to the backend. About 150 lines of transport. Hand-rolled rather
than `openapi-fetch`, because "refresh once, retry once, never loop" is awkward in a middleware
model and this is the one place where that behaviour must be exactly right. Route paths are typed by
hand per resource (about 14 routes) and verified by B6's integration test rather than by the type
system — that is the accepted cost of option 1.

**The 401 this client will actually see is not the contract's.** For an expired or malformed JWT the
**gateway** answers, not our handler:

```
curl -H "Authorization: Bearer not-a-jwt" …/functions/v1/events
{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT format","msg":"Invalid JWT format"}
HTTP 401
```

`openapi.yaml` says 401 → `Unauthenticated` envelope, and our `unauthenticated()` only runs when the
gateway passed the request. A client that reads `body.ok` before deciding to refresh throws on this
body. So: **refresh on any 401 regardless of body shape.**

**Files**

- Create `packages/api-client/package.json` — name `@planpal/api-client`, `private: true`,
  `type: module`, `main`/`types`/`exports` all `./src/index.ts` (extensionless, like
  `@planpal/calendar-core`; Metro appends candidate extensions rather than substituting them, which
  is what broke the mobile bundle in PR #3 defect 10). Scripts `build`, `typecheck`, `lint`,
  `test: vitest run --coverage`, `clean`. Dependency `@planpal/types: workspace:*`.
- Create `packages/api-client/tsconfig.json` — copy `packages/calendar-core/tsconfig.json`.
- Create `packages/api-client/vitest.config.ts` — **coverage thresholds set now, at creation (§15)**:
  `thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 }`, `provider: 'v8'`,
  `include: ['src/**/*.ts']`, `exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/types.ts']`.
  70 rather than 90 because this layer needs mocking (docs/TESTING.md's `api-client` row).
- Create `packages/api-client/src/errors.ts` — `PlanPalApiError extends Error` with
  `readonly code: ApiErrorCode`, `message`, `readonly status: number`,
  `readonly details?: Record<string, string[]>`, `name = 'PlanPalApiError'` (AD-7 verbatim).
  `ApiErrorCode` comes from `@planpal/types`' generated enum (AD-8). Plus
  `mapNonEnvelopeError(status, text): PlanPalApiError` for gateway bodies.
- Create `packages/api-client/src/http.ts` — the `HttpClient` factory described in Steps.
- Create `packages/api-client/src/index.ts` — re-exports.
- Create `packages/api-client/src/http.test.ts` — the unit suite.
- Modify `pnpm-lock.yaml` — from `pnpm install` linking the new workspace package.

**Interfaces this task produces** (B2–B6, T7, T18, T20 rely on these exact names)

```ts
export interface HttpOptions {
  baseUrl: string; // e.g. http://127.0.0.1:54321/functions/v1
  anonKey: string;
  getAccessToken(): Promise<string | null>;
  refresh(): Promise<string | null>; // resolves to a new access token, or null
}
export interface Http {
  json<T>(
    path: string,
    init?: { method?: string; body?: unknown; query?: Record<string, string> },
  ): Promise<T>;
  text(path: string, init?: { query?: Record<string, string> }): Promise<string>;
  empty(path: string, init?: { method?: string }): Promise<void>;
}
export function createHttp(opts: HttpOptions): Http;
```

**Steps**

1. Write the failing tests. `packages/api-client/src/http.test.ts`, with a stubbed global `fetch`
   (`vi.stubGlobal('fetch', vi.fn())`), one `it(...)` per behaviour:
   - `it('attaches the bearer token and the apikey header')`
   - `it('unwraps ok:true envelopes to data')`
   - `it('maps ok:false to PlanPalApiError with the contract code')`
   - `it('refreshes once and retries once on a 401, then succeeds')` — asserts `refresh` called
     exactly once and `fetch` called exactly twice.
   - `it('refreshes on a 401 whose body is not an ApiResult envelope')` — body is the gateway's
     `{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT",…}`. This is the case the contract does not describe.
   - `it('throws UNAUTHENTICATED and does not loop when the retry also 401s')` — asserts `fetch`
     called exactly twice, never three times.
   - `it('maps a non-JSON 5xx body to PlanPalApiError without JSON.parse throwing')`
   - `it('returns text/calendar bodies as a string')`
2. Run them and record the red run: `pnpm --filter @planpal/api-client test`. Expected failure —
   `Cannot find module './http'` (or `Failed to resolve import "./http"`), because no implementation
   exists yet. Paste it.
3. Implement `errors.ts` then `http.ts`. Order of operations inside `http.ts`, exactly:
   attach `Authorization: Bearer <access>` and `apikey: <anonKey>` → send → **on any 401 regardless
   of body shape**, call `refresh()` once and retry once → if still 401, throw
   `PlanPalApiError('UNAUTHENTICATED', …, 401)` → if the body is not an `ApiResult` envelope
   (gateway 401/404/5xx, `text/calendar`), map to `PlanPalApiError` with the status and a synthetic
   code, **never `JSON.parse` blindly** → otherwise unwrap `ok:true` to `data` and throw on
   `ok:false`. Never loop: at most two `fetch` calls per logical request.
4. Run the tests again and record them passing, including the coverage summary — the run must satisfy
   the 70 % thresholds or it fails, which is the point of setting them at creation.
5. Run the surrounding gates: `pnpm install` (links the workspace package), then `pnpm lint`,
   `pnpm typecheck`, `pnpm test`, `pnpm build`.

**Definition of done**

- `pnpm --filter @planpal/api-client test` exits 0 and its own output reports lines, branches,
  functions and statements all ≥ 70. Paste the coverage table.
- All eight `it(...)` titles above exist and pass.
- `pnpm typecheck` green with the new package in the graph; `pnpm build` lists
  `@planpal/api-client#build`.
- `grep -rn "fetch(" packages/api-client/src --include=*.ts | grep -v test` shows calls only inside
  `http.ts` — the transport is the single place that touches the network.

**Rollback**

`git rm -r packages/api-client`, then `pnpm install` to unlink it. Nothing imports it yet, so removal
is clean. Do this before B2 lands; after B2 the auth layer must come out with it.

**Risks that make it slip**

- React Native's `fetch` differs from the web's — no `Blob` support worth relying on, different
  error objects on network failure. The unit tests stub `fetch`, so they cannot see this; B6 and T18
  are where it surfaces. Return `string` from `text()`, never `Blob` (specs §B).
- Creating a new workspace package requires a root `pnpm install` to write the lockfile. If the tool
  policy refuses, **stop and ask** (see A1).
- `ApiErrorCode` must come from the generated types. If AD-8's enum is not in
  `packages/types/src/generated/openapi.ts`, stop: that is a contract task, not a client task.

---

# Task B2 — `auth.ts` and the per-platform `SessionStore`

**Implements:** specs §B (AD-9 gotcha) · §4 client, §5 · **Owner:** Arlo · **Ideal days:** 0.5
**Gated on:** nothing, but **needs `@supabase/supabase-js` installed** — see Risks.
**Blocks:** T7, B6.

`@supabase/supabase-js` is not installed anywhere in the workspace today (the Edge Functions import
it from `esm.sh`; the apps have never held a session). This task installs it into
`packages/api-client` only — B5's lint rule then makes that the only legal place for it.

**Files**

- Modify `packages/api-client/package.json` — add `@supabase/supabase-js` as a dependency, pinned to
  an exact version (not `^2`), for the same reason the Edge Functions' `esm.sh/@supabase/supabase-js@2`
  specifier is called out in specs §C: composite-return typing differs between minors.
- Create `packages/api-client/src/auth.ts` — `AuthClient` and `SessionStore` per §4.
- Create `packages/api-client/src/auth.test.ts`.
- Modify `packages/api-client/src/index.ts` — export `createAuthClient`, `AuthClient`,
  `SessionStore`, `Session`.
- Modify `pnpm-lock.yaml`.

**Interfaces this task produces** (T7 and B3 rely on these)

```ts
export interface SessionStore {
  // AD-9
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface AuthClient {
  signInWithPassword(email: string, password: string): Promise<Session>;
  signUpWithPassword(email: string, password: string): Promise<Session>;
  signInWithOAuth(provider: 'google' | 'apple'): Promise<void>; // redirects
  signOut(): Promise<void>;
  getSession(): Promise<Session | null>;
  onAuthStateChange(cb: (s: Session | null) => void): () => void;
}
```

**Steps**

1. Write the failing tests. `packages/api-client/src/auth.test.ts`, against a fake `SessionStore`
   backed by a `Map`:
   - `it('persists the session through the provided SessionStore, never localStorage directly')`
   - `it('chunks a stored value larger than 2048 bytes across multiple keys')` — the iOS Keychain
     limit; see Risks.
   - `it('reassembles a chunked value on read')`
   - `it('clears every chunk on signOut')`
   - `it('signOut clears the occurrence cache prefix')` — asserts the injected `CacheAdapter.clear`
     was called with `'occ:'`. A shared device must not show the previous user's calendar. _(The
     adapter itself lands in B4; here it is an injected interface with a spy.)_
2. Run and record the red run: `pnpm --filter @planpal/api-client test auth`. Expected
   `Failed to resolve import "./auth"`.
3. Implement `auth.ts`. `createAuthClient` wraps `createClient` from `@supabase/supabase-js` with a
   `storage` adapter delegating to the injected `SessionStore`, and exposes the six methods above.
   **`expo-secure-store` rejects values over 2048 bytes on iOS and a supabase-js session JSON is
   larger**, so the store contract is: chunk values over 2000 bytes as `<key>.0`, `<key>.1`, … with a
   `<key>.n` count, or persist only the refresh token and keep the access token in memory. Implement
   chunking in this package so both platforms share it — Android has no such limit, so an
   Android-only dogfood window will never surface the bug.
4. Run the tests again and record them passing, with coverage still ≥ 70.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Definition of done**

- All five `it(...)` titles pass, coverage still ≥ 70.
- `grep -rn "@supabase/supabase-js" packages apps --include=*.ts --include=*.tsx --include=*.json`
  matches only `packages/api-client`. That invariant becomes machine-checked in B5.
- The 2048-byte chunking test passes with a fixture session JSON of at least 3 KB — assert the store
  received more than one key, not just that the round-trip worked.

**Rollback**

Revert the commit and run `pnpm install` to drop `@supabase/supabase-js` from the lockfile. B1's
`http.ts` does not import `auth.ts`, so B1 stands on its own afterwards.

**Risks that make it slip**

- **The `pnpm add` policy refusal.** This task cannot be completed without installing
  `@supabase/supabase-js`. If refused, stop and ask; do not vendor it, do not import from `esm.sh`
  in a Node/Metro package.
- The specs plan puts the secure-store size limit at 0.5 day **if discovered late**. Writing the
  chunking test now is precisely how it is discovered early.
- `expo-secure-store` itself is not installed and is not needed here — the mobile `SessionStore`
  implementation lands in T7 inside `apps/mobile`. This package only defines the interface, which is
  why the chunking logic belongs here and not there.

---

# Task B3 — The resource methods

**Implements:** specs §B "Specification deltas to §5" · §5's `PlanPalClient` · **Owner:** Arlo
**Ideal days:** 1 · **Gated on:** nothing · **Depends on:** B1 (and B2 for the composition root).
**Blocks:** T7, T18, T19, T20.

The 14 routes, typed per resource from `@planpal/types`. §5's interface is wrong in four places and
those corrections are mandatory, not optional: `devices.register` returns `Device` (not `void`) and
its 409 must be caller-visible; `export.ical` returns `string` (not `Blob` — React Native's `fetch`
Blob support is partial); a `health()` method must exist (T29's offline indicator wants it); and
`occurrences.range` takes a read policy.

**Files**

- Create `packages/api-client/src/resources/events.ts`, `occurrences.ts`, `profile.ts`,
  `devices.ts`, `notificationPreferences.ts`, `friendCode.ts`, `export.ts`, `health.ts`.
- Create `packages/api-client/src/client.ts` — `createPlanPalClient()`, the composition root.
- Create `packages/api-client/src/resources/resources.test.ts`.
- Modify `packages/api-client/src/index.ts`.

**Routes, verified against `openapi.yaml` and the handlers** — implement exactly these:

| Method                                        | Route                                           | Returns                                       |
| --------------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `events.list({limit?, cursor?})`              | `GET /events`                                   | `Paginated<Event>`                            |
| `events.create(input)`                        | `POST /events`                                  | `Event` (201)                                 |
| `events.get(id)`                              | `GET /events/{id}`                              | `Event`                                       |
| `events.update(id, patch)`                    | `PATCH /events/{id}`                            | `Event`                                       |
| `events.remove(id)`                           | `DELETE /events/{id}`                           | `void` (202 `EmptyResult`)                    |
| `events.overrideOccurrence(id, date, patch)`  | `PATCH /events/{id}/occurrences/{date}`         | `EventOccurrence`                             |
| `events.cancelOccurrence(id, date)`           | `DELETE /events/{id}/occurrences/{date}`        | `void` (202)                                  |
| `occurrences.range(from, to, opts?)`          | `GET /occurrences?from&to`                      | `EventOccurrence[]`                           |
| `profile.get()` / `update(p)` / `remove()`    | `GET`/`PATCH`/`DELETE /me`                      | `Profile` / `Profile` / `void` (202)          |
| `notificationPreferences.get()` / `update(p)` | `GET`/`PUT /me/notification-preferences`        | `NotificationPreference`                      |
| `devices.register(token, platform)`           | `POST /me/devices`                              | `Device`; 409 → `PlanPalApiError('CONFLICT')` |
| `devices.unregister(token)`                   | `DELETE /me/devices/{token}`                    | `void` (202)                                  |
| `friendCode.get()` / `rotate()`               | `GET /friend-code` / `POST /friend-code/rotate` | `FriendCode`                                  |
| `export.ical()`                               | `GET /export/ical`                              | `string` (`text/calendar`)                    |
| `health()`                                    | `GET /healthz`                                  | `Health`                                      |

**Steps**

1. Write the failing tests. `packages/api-client/src/resources/resources.test.ts`, stubbed `fetch`:
   - `it('sends each route at the path and method the contract declares')` — a table-driven test over
     all 14 rows above, asserting the URL and method the stub received. This is what stands in for
     the type safety option 1 gives up.
   - `it('returns the registered Device from devices.register')`
   - `it('surfaces a 409 from devices.register as PlanPalApiError with code CONFLICT')`
   - `it('returns export.ical as a string, not a Blob')`
   - `it('rejects an occurrences range longer than 180 days by chunking, never by sending it')` —
     `MAX_RANGE_DAYS = 180` lives in `packages/recurrence/src/types.ts` and the endpoint 400s above
     it, so the client must chunk rather than discover this at runtime.
   - `it('normalises (2026-01-15, 2026-03-02) to three whole months and returns only in-range items')`
     — asserts three `fetch` calls and that the returned items are clipped to `[from, to]` (AD-10).
2. Run and record the red run: `pnpm --filter @planpal/api-client test resources`. Expected
   `Failed to resolve import "./events"`.
3. Implement the eight resource modules and `client.ts`. `occurrences.range(from, to, opts?: {
policy?: 'network-first' | 'cache-first' | 'cache-only' })` normalises to whole calendar months,
   fetches each missing month (chunking any request to ≤ 180 days), stitches, and returns items
   within `[from, to]`. The cache itself is B4; here `range` takes the `CacheAdapter` as an injected
   dependency and the tests pass a spy.
4. Run the tests again and record them passing, coverage still ≥ 70.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Definition of done**

- The table-driven route test covers all 14 rows and passes; a wrong path or method fails it.
- `it('surfaces a 409 …')` and `it('returns export.ical as a string …')` pass — the two §5 defects
  that would otherwise reach the apps.
- Coverage ≥ 70 across all four metrics.
- B6's integration test (below) exercises `events.list()` against the real stack; until B6 lands,
  every route claim in this task is a **hypothesis verified only against a stub**. Label it that way
  in the PR.

**Rollback**

Revert the commit. `http.ts` and `auth.ts` stand alone; nothing outside the package imports the
resources yet.

**Risks that make it slip**

- Month normalisation is where off-by-one bugs live: a `from` mid-month, a `to` on the first of a
  month, and a range crossing a year boundary. The named test pins the first two; add a
  `(2026-12-20, 2027-01-05)` case.
- `Paginated<Event>`'s cursor shape must match what `GET /events` actually returns
  (`{items, nextCursor}` — see `contract-shape.test.ts`). Read the generated type, do not assume.
- 14 hand-typed route paths is 14 chances to fumble a segment. That is the accepted cost of option 1,
  and B6 is the mitigation.

---

# Task B4 — The month-keyed cache seam

**Implements:** specs §B "CacheAdapter" · AD-10 · **Owner:** Arlo · **Ideal days:** 0.5
**Gated on:** nothing · **Depends on:** B3. **Blocks:** T29 (which becomes a rewrite if this lands
without a read policy and freshness metadata).

`GET /occurrences` takes an arbitrary `(from,to)`, so caching that verbatim gives a cache that never
hits twice. Cache per whole month, behind the client. The envelope — not a bare array — is what makes
T29's "last updated" state possible without a retrofit.

**Files**

- Create `packages/api-client/src/cache.ts` — `CacheAdapter` interface plus the in-memory default.
- Create `packages/api-client/src/cache.test.ts`.
- Modify `packages/api-client/src/resources/occurrences.ts` — wire the three read policies.
- Modify `packages/api-client/src/resources/events.ts` — every write clears `occ:<userId>:*`.
- Modify `packages/api-client/src/index.ts`.

**Interfaces this task produces** (T29 relies on these exactly)

```ts
export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  clear(prefix?: string): Promise<void>;
}
/** Stored under `occ:<userId>:<yyyy-mm>`. The envelope, not the bare array. */
export interface CachedMonth {
  fetchedAt: string; // ISO 8601
  items: EventOccurrence[];
}
export function createMemoryCache(): CacheAdapter;
```

**Steps**

1. Write the failing tests. `packages/api-client/src/cache.test.ts`:
   - `it('keys a month as occ:<userId>:<yyyy-mm>')`
   - `it('stores a fetchedAt envelope, not the bare array')`
   - `it('cache-first serves a stored month without calling fetch')`
   - `it('cache-only throws rather than calling fetch when a month is missing')`
   - `it('network-first refetches and overwrites the stored month')`
   - `it('clears every month for the user after events.create')` — a recurring master can touch any
     month, so a targeted invalidation is wrong.
   - `it('clears every user\'s months on signOut')` — prefix `occ:`.
2. Run and record the red run: `pnpm --filter @planpal/api-client test cache`. Expected
   `Failed to resolve import "./cache"`.
3. Implement `cache.ts` and wire the policies. In-memory adapter only for M3; the `AsyncStorage`
   adapter is T29. AD-9 bans **tokens** from `AsyncStorage`, not calendar data, so that is legal.
4. Run the tests again and record them passing, coverage still ≥ 70.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Definition of done**

- All seven `it(...)` titles pass.
- `grep -n "fetchedAt" packages/api-client/src/cache.ts` shows the envelope is written by `set`, not
  reconstructed by the caller.
- A stored month read back through `cache-first` returns both `items` and `fetchedAt` to the caller,
  so T29 can render "last updated" without changing this interface.

**Rollback**

Revert the commit. B3's `occurrences.range` reverts to always-network, which is the pre-B4 behaviour
and is correct, just uncached.

**Risks that make it slip**

- The invalidation rule is deliberately coarse (clear all months on any write). Anything cleverer
  needs to know which months a recurrence rule touches, which is the engine's job and not worth
  pulling into the client this month.
- Getting `signOut` → `clear('occ:')` wired means `auth.ts` depends on the cache. Inject the adapter;
  do not import `cache.ts` from `auth.ts` and create a cycle.

---

# Task B5 — Lint enforcement that can actually fail

**Implements:** specs §B "Lint enforcement that can fail" · §5, §15 last bullet · **Owner:** Arlo
**Ideal days:** 0.5 · **Gated on:** nothing · **Depends on:** B1–B4 existing, so the rule has
somewhere legal to point.

§5 says to ban bare `fetch` with `no-restricted-imports`. **That cannot work: `fetch` is a global,
and `no-restricted-imports` cannot see it.** The rule is `no-restricted-globals`. The root ESLint
config has no `no-restricted-*` rules today.

**Files**

- Modify `eslint.config.mjs` — one new config object, scoped as below.
- Create `packages/api-client/src/lint-rules.test.ts` — proves the rule fires.

**The rule**

- `no-restricted-imports`: `@supabase/supabase-js` and `@supabase/*`, message
  `use @planpal/api-client`.
- `no-restricted-globals`: `fetch`, same message.
- Scope: `apps/**/*.{ts,tsx}` and `packages/**/*.{ts,tsx}`, **except** `packages/api-client/**`,
  `**/*.test.{ts,tsx}` and `supabase/**`.

**Steps**

1. Write the failing test. `packages/api-client/src/lint-rules.test.ts` uses the ESLint Node API
   (`new ESLint({ cwd: repoRoot })` and `lintText(code, { filePath })`) on three snippets:
   - `it('flags a supabase-js import in apps/web')` — `filePath: apps/web/src/x.ts`, expect exactly
     1 error.
   - `it('flags a bare fetch call in apps/mobile')` — `filePath: apps/mobile/src/x.ts`, expect
     exactly 1 error.
   - `it('allows both inside packages/api-client')` — `filePath: packages/api-client/src/x.ts`,
     expect 0 errors.
2. Run and record the red run **before adding the rule**:
   `pnpm --filter @planpal/api-client test lint-rules`. Expected two failures —
   `expected 0 to be 1` on each of the first two `it`s, because no restriction exists yet. Paste it.
   The third passes vacuously, which is exactly why the first two must be seen red.
3. Add the config object to `eslint.config.mjs`.
4. Run the test again and record all three passing.
5. Run the surrounding gates: `pnpm lint` on the **whole repo** — this is the step that discovers
   any existing violation. Fix each by routing through the client, never by widening the exception
   list. Then `pnpm typecheck`, `pnpm test`.

**Definition of done**

- All three `it(...)` titles pass, and the PR body carries step 2's red output.
- `pnpm lint` green across the repo with the rule active.
- The exception list in `eslint.config.mjs` contains exactly `packages/api-client/**`,
  `**/*.test.{ts,tsx}` and `supabase/**` — nothing added to make an existing file pass.

**Rollback**

Revert the commit. Removing the config object removes the rule; the test then fails, so revert both
together — the test is only meaningful with the rule present.

**Risks that make it slip**

- `eslint` must be resolvable from `packages/api-client` for the Node API test. It is a root
  devDependency under `node-linker=hoisted`, so it resolves; if that changes, the test needs `eslint`
  declared locally, which is another install.
- `no-restricted-globals` will also flag legitimate `fetch` use in any future script under
  `packages/**`. Prefer moving such code behind the client over widening the scope.
- Linting text through the Node API is slower than the CLI. Keep it to these three snippets.

---

# Task B6 — Prove the refresh path against a real 401

**Implements:** specs §B "Test strategy — Integration" · §5 DoD · **Owner:** Arlo
**Ideal days:** 0.5 · **Gated on:** nothing · **Depends on:** B1, B2, B3.

The unit tests stub `fetch`, so they prove the client's logic and nothing about the gateway. This
proves the real thing without waiting an hour for a token to expire.

**Files**

- Modify `supabase/tests/package.json` — add `@planpal/api-client: workspace:*` as a dependency.
- Create `supabase/tests/src/api-client.test.ts`.
- Modify `pnpm-lock.yaml`.

**Steps**

1. Write the failing test. `supabase/tests/src/api-client.test.ts`:
   - `it('refreshes a gateway-rejected access token and retries once')` — create a test user via
     `createTestUser()` from `./harness`; sign in to obtain the real refresh token; mint an access
     token **locally** with the stack's JWT secret
     `super-secret-jwt-token-with-at-least-32-characters-long`, carrying the user's real `sub` and an
     `exp` in the past; construct the client with that access token and the real refresh token; call
     `events.list()`. Expect: gateway 401 → refresh → retry → 200 with an `items` array.
   - `it('throws rather than looping when the refresh token belongs to another user')` — the watched
     fail. Give the client user A's expired access token and user B's refresh token. The retry must
     401 and throw `PlanPalApiError` with code `UNAUTHENTICATED`; it must **not** loop.
2. Run and record the red run:
   `pnpm --filter @planpal/integration-tests test:integration -- api-client`. Expected
   `Cannot find package '@planpal/api-client'` before the dependency is declared — declare it, run
   `pnpm install`, and then the meaningful red run is on whichever assertion the client does not yet
   satisfy. Paste both.
3. Make it pass. Any change here is a change to `http.ts` or `auth.ts`, not to the test.
4. Run the test again and record it passing.
5. Run the surrounding gates: `pnpm db:start` (Docker first — see the environment section), then
   `pnpm test:integration` in full, then `pnpm lint` and `pnpm typecheck`.

**Definition of done**

- Both `it(...)` titles pass, and `pnpm test:integration` is green in full (195 existing tests plus
  the new ones).
- The second test's assertion counts `fetch` invocations or observes at most two requests in the
  stack's logs — "does not loop" must be asserted, not assumed.
- Both apps render occurrences fetched through the client against the **local** stack. That half of
  §B's DoD is completed in T18 (mobile) and T20 (web); record it as outstanding here rather than
  claiming it.

**Rollback**

Revert the commit and run `pnpm install` to drop the workspace dependency from `supabase/tests`.

**Risks that make it slip**

- Minting a JWT needs an HMAC-SHA256 signer. Node's `node:crypto` is enough; do not add a JWT library
  for this.
- The gateway's exact 401 code differs between a malformed token
  (`UNAUTHORIZED_INVALID_JWT_FORMAT`) and an expired one. Assert on the **status** and on the
  client's resulting behaviour, not on the gateway's code string — that string is not our contract.
- A stale edge isolate will make a passing client look broken.
  `docker restart supabase_edge_runtime_planpal` before debugging.

---

# Task G1 — Replace the `__birthday__` sentinel with a protected `is_birthday` column

**Implements:** specs §G, option 1 (migration half) · §10, §P4 note · **Owner:** Scott
**Ideal days:** 0.5 · **Gated on:** nothing. **Blocks:** G2, and therefore T19's colour picker.

`sync_birthday_event()` finds and replaces its own row through `color_label = '__birthday__'`. The
sentinel is a **user-visible, user-writable colour value**, which produces a live defect found by
running the code, not by reading it:

```
PATCH /me {birthday: "1990-10-14"}                  -> 200
PATCH /events/<birthday id> {colorLabel:"#ff0000"}  -> 200
PATCH /me {birthday: "1990-11-02"}                  -> 200
GET /events -> TWO "Birthday" masters: one "#ff0000" (10-14), one "__birthday__" (11-02)
```

Recolouring the birthday master detaches it from the sentinel and orphans it. Conversely, a user who
sets `colorLabel: "__birthday__"` on any event gets it deleted at the next birthday change.

**Files**

- Create `supabase/migrations/20260909000002_birthday_flag.sql` — the column, the backfill, the
  unique index, the protection trigger, and the rewritten `sync_birthday_event()`.
- Create `supabase/tests/src/birthday.test.ts` — the four DoD bullets as tests.

**Migration content** (specs §G gives this verbatim; reproduce it, do not paraphrase)

```sql
alter table public.events add column is_birthday boolean not null default false;

-- Backfill. Keep the newest sentinel master per owner; the older ones are the
-- orphans the sentinel design produced.
with ranked as (
  select id, row_number() over (partition by owner_id order by created_at desc) as rn
    from public.events where is_master and color_label = '__birthday__')
delete from public.events where id in (select id from ranked where rn > 1);
update public.events set is_birthday = true, color_label = null
 where is_master and color_label = '__birthday__';

create unique index events_one_birthday_per_owner
  on public.events (owner_id) where is_birthday and is_master;

-- The flag is system-owned. A plain request runs as `authenticated`; the
-- SECURITY DEFINER sync runs as the function owner. 42501 maps to 403 in dbError.
create or replace function public.protect_is_birthday() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.is_birthday is distinct from coalesce(old.is_birthday, false) then
    raise exception 'is_birthday is system-managed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.protect_is_birthday() from public;
grant execute on function public.protect_is_birthday() to service_role;
create trigger events_protect_is_birthday before insert or update of is_birthday
  on public.events for each row execute function public.protect_is_birthday();

-- Same body as 20260614000001's sync_birthday_event, with two lines changed:
--   delete ... where owner_id = p_user_id and is_birthday and is_master;
--   insert ... is_birthday = true, color_label = null
create or replace function public.sync_birthday_event(p_user_id uuid) ...
```

`protect_is_birthday()` is `SECURITY INVOKER`, so §15's revoke rule does not strictly bite — but the
`revoke all … from public` line is in the migration anyway, in the same migration, because
`grants.test.ts`'s second assertion ("no function of ours executable by PUBLIC, whatever its security
mode") covers invoker functions too. `20260908000001_revoke_public_execute_on_helpers.sql` is the
precedent.

**Steps**

1. Write the failing tests. `supabase/tests/src/birthday.test.ts`:
   - `it('returns exactly one birthday master with isBirthday true and colorLabel null')` — will fail
     on `isBirthday` until G2; assert `colorLabel === null` and the count here, and add the
     `isBirthday` assertion in G2. State that split in a comment.
   - `it('still yields exactly one birthday master after the master is recoloured')` — set a
     birthday, `PATCH` the master's `colorLabel` to `#ff0000`, set a different birthday, then
     `GET /events` and assert exactly one `Birthday` master. **This is the watched failure: it fails
     on the current tree** — two masters were observed live.
   - `it('never puts the string __birthday__ on the wire')` — `GET /events` and
     `GET /occurrences?from&to` over a window containing the birthday; assert the raw response text
     contains no `__birthday__`.
   - `it('rejects setting is_birthday as authenticated with SQLSTATE 42501')` — via the `pg` client
     in `./db`, `set role authenticated` and `update public.events set is_birthday = true`; assert
     the error code is `42501`.
   - `it('keeps one birthday master when the backfill runs over two sentinel rows')` — apply
     migrations through `20260908000001` on a scratch database, insert two sentinel masters for one
     owner, apply `20260909000002`, assert one row remains with the flag set and that
     `events_one_birthday_per_owner` exists in `pg_indexes`.
2. Run and record the red run: `pnpm db:reset` then
   `pnpm --filter @planpal/integration-tests test:integration -- birthday`. Expected failures — the
   orphaning test reports two `Birthday` masters, the `42501` test reports the update succeeding, and
   the backfill test reports no such column `is_birthday`. Paste all three.
3. Write the migration. Then `pnpm db:reset` — this is what proves the chain applies from scratch
   (§10), and it must be run before the tests, not after.
4. Re-run step 2's test command and record it passing.
5. Run the surrounding gates and paste each:
   - `pnpm db:reset` — all 15 migrations apply to an empty database, seed loads.
   - `pnpm test:integration` in full, including `grants.test.ts` and `rls.test.ts`.
   - `deno check --config supabase/functions/deno.json */index.ts` from `supabase/functions` — should
     be unaffected, since nothing is exposed yet; if it fails, the change leaked into a handler.

**Definition of done**

- `pnpm db:reset` exits 0 and its output lists `20260909000002_birthday_flag.sql`.
- `grants.test.ts` still green — the new trigger function is `SECURITY INVOKER` and revoked from
  `PUBLIC`, so the audit must not gain a finding.
- `docker exec supabase_db_planpal psql -U postgres -c "\d public.events"` shows
  `is_birthday | boolean | not null default false` and the partial unique index
  `events_one_birthday_per_owner`.
- Setting `is_birthday` as `authenticated` returns SQLSTATE 42501.
- Changing the birthday after recolouring the master yields exactly one birthday master — with the
  pasted red run from step 2 proving that test failed before the migration.

**Rollback**

Migrations are forward-only, so there is no `down`. The forward "down" migration would be, in this
order: `drop trigger events_protect_is_birthday on public.events;`
`drop function public.protect_is_birthday();`
`drop index events_one_birthday_per_owner;`
`create or replace function public.sync_birthday_event(p_user_id uuid) …` restored to the
`color_label = '__birthday__'` body from `20260614000001`, with a
`update public.events set color_label = '__birthday__' where is_birthday and is_master;` backfill
**before** `alter table public.events drop column is_birthday;`. Note that the backfill deletion in
G1 is destructive and not reversible — the orphaned masters it removes are gone. That is intended
(they are unreachable rows the sentinel design produced), but say so in the PR, and if this ever runs
against a shared environment take a backup first per `docs/BOOTSTRAP.md` step 5.

**Risks that make it slip**

- The scratch-database backfill test needs a second local database. Use
  `docker exec supabase_db_planpal psql -U postgres -c "create database backfill_probe"` and apply
  the migration files with `psql -d backfill_probe -f`, then drop it in `afterAll`. Do not run the
  backfill test against the main local database — it inserts sentinel rows that the other specs would
  then see.
- `current_user in ('authenticated','anon')` is the guard. If a future policy makes requests arrive
  as a different role, the protection silently stops applying — which is the same class of latent
  failure as F1's `FOR UPDATE`. The `42501` test is what notices.

---

# Task G2 — Expose `isBirthday` on `Event`

**Implements:** specs §G, option 1 (contract half) · **Owner:** Scott · **Ideal days:** 0.5
**Gated on:** §15 two-dev sign-off (it is a contract change) · **Depends on:** G1, and **land it
after C2** so the serializer edit inherits the generated row types rather than another hand-written
interface. **Blocks:** T19's colour picker, which must never see the sentinel.

`isBirthday` goes on `Event` only — masters. `EventOccurrence` gets it later if the UI needs it,
because that field would have to pass through the engine's `EventRecord` and the generated Deno
mirror, which is a much larger change for no current consumer.

**Files**

- Modify `packages/api-contract/openapi.yaml` — `Event.isBirthday: {type: boolean}`, added to
  `required`.
- Modify `packages/types/src/generated/openapi.ts` — regenerated, committed (§15).
- Modify `supabase/functions/_shared/serialize.ts` — one field on `EventModel`, one line in
  `toEventModel`. After C2, `EventRowFull` is a `Database['public']['Tables']['events']['Row']`
  alias, so `is_birthday` arrives typed with no edit to the row interface at all.
- Modify `supabase/functions/events/index.ts` — add `is_birthday` to the event column list, if that
  handler selects columns explicitly rather than `*`.
- Modify `supabase/tests/src/contract-shape.test.ts` — add `'is_birthday'` to `SNAKE_CASE_LEAKS`.
  _(Do not add `isBirthday` to `EVENT_REQUIRED` by hand if F2a has landed — that list is then read
  from `openapi.yaml` at run time and updates itself. If F2a has not landed, add it to both.)_
- Modify `supabase/tests/src/birthday.test.ts` — promote the deferred `isBirthday` assertion from G1.

**Steps**

1. Write the failing test. In `supabase/tests/src/birthday.test.ts`, add
   `it('exposes isBirthday true on the birthday master and false on an ordinary event')`, and
   complete G1's first test by asserting `isBirthday === true` alongside `colorLabel === null`.
2. Run and record the red run:
   `pnpm --filter @planpal/integration-tests test:integration -- birthday`. Expected
   `expected undefined to be true` — the column exists after G1, but nothing serialises it.
3. Make the changes: edit `openapi.yaml`, `pnpm contract:generate`, edit `serialize.ts` and the
   events handler's column list, add the `SNAKE_CASE_LEAKS` entry.
4. `docker restart supabase_edge_runtime_planpal`, then re-run step 2's command and record it
   passing.
5. Run the surrounding gates and paste each:
   - `pnpm --filter @planpal/api-contract validate`
   - `pnpm contract:generate` then `git diff --exit-code -- packages/types/src/generated` — clean.
   - `deno check --config supabase/functions/deno.json */index.ts` from `supabase/functions`.
   - `pnpm typecheck`, `pnpm test`, `pnpm test:integration` in full.

**Definition of done**

- `GET /events` after setting a birthday returns exactly one item with `isBirthday: true` and
  `colorLabel: null`.
- `grep -rn "__birthday__" supabase/functions supabase/tests` returns nothing outside a historical
  comment; no integration-suite response body contains the string.
- `contract.yml` green with the new required property; `contract-shape.test.ts` green.
- T19's colour picker can branch on `isBirthday` without parsing a title or a colour — check that by
  reading the field, not by inferring it.

**Rollback**

Revert the commit and re-run `pnpm contract:generate` to confirm the generated bytes return. The G1
migration stays — the column and its protection are independently correct, and dropping a shipped
column to undo a serializer change would be a forward migration for no reason.

**Risks that make it slip**

- Making `isBirthday` **required** in `Event` means every serializer path must emit it, including the
  override route's `EventOccurrence` (which must **not** — it is not an `Event`). `contract-shape.test.ts`
  already asserts the override response carries no `Event` properties; keep that assertion.
- If G2 lands before C2, `EventRowFull` needs the field added by hand and the same edit gets
  reverted by C2. That is the whole reason for the ordering.

---

# Task C0 — Pin the `supabase` CLI to one exact version

**Implements:** specs §C "Recommendation" · specs "Things the plan is wrong about" #10 · **Owner:** Scott
**Ideal days:** 0.25 · **Gated on:** the CLI-pin decision (**recommended: 2.117.0**, verified as
`latest` on 2026-09-08). **Blocks:** C2 and F2b, whose gates diff generated output and will flap
otherwise.

`npx --yes supabase@latest` in five `package.json` scripts, `version: latest` in `ci.yml`, and
`npx --yes supabase@latest` in `deploy-staging.yml`. The integration stack therefore changes under
the team without a commit, which is a latent flake for the whole `integration` job, not just for a
drift gate.

**Files**

- Modify `package.json` — `db:start`, `db:stop`, `db:reset`, `db:diff`, `db:push` all use
  `npx --yes supabase@2.117.0`.
- Modify `.github/workflows/ci.yml` — `supabase/setup-cli@v1` `version: 2.117.0`.
- Modify `.github/workflows/deploy-staging.yml` — the three `npx --yes supabase@latest` invocations
  (`link`, `db push`, `functions deploy`) become `supabase@2.117.0`.
- Modify `docs/BOOTSTRAP.md` — the CLI bullet names the pinned version, and while the file is open,
  fix the stale **Node 20** claim: `package.json` `engines` and every CI job say **22** (specs
  "Things the plan is wrong about" #9).

**Steps**

1. The deliverable is a pin, so there is no unit test. Record the baseline first:
   `npx --yes supabase@latest --version` → `2.117.0` on 2026-09-08. Paste it. That number is the pin.
2. Make the edits. Grep to prove none was missed:
   `grep -rn "supabase@latest\|version: latest" package.json .github docs` must return nothing.
3. Verify the pinned CLI actually works end to end: `pnpm db:stop`, then `pnpm db:start`, then
   `pnpm db:reset`, then `pnpm test:integration`. Paste the version line from `db:start`'s output and
   the suite's summary.
4. Run the surrounding gates: `prettier --check --end-of-line auto package.json docs/BOOTSTRAP.md
.github/workflows/ci.yml .github/workflows/deploy-staging.yml` — format only the files that were
   already clean at HEAD.

**Definition of done**

- `grep -rn "supabase@latest" .` (excluding `node_modules`) returns nothing.
- `pnpm db:start` prints `2.117.0`, `pnpm db:reset` applies the chain, `pnpm test:integration` is
  green.
- `docs/BOOTSTRAP.md` says Node 22 and names the pinned CLI version.

**Rollback**

Revert the commit; the scripts return to `@latest`. Harmless in itself — but C2's and F2b's gates
then become time bombs, so do not revert this while either of those is in place.

**Risks that make it slip**

- A pinned CLI goes stale. Add a line to `docs/BOOTSTRAP.md` saying who bumps it and that a bump is
  its own PR which re-runs `supabase gen types` and commits the diff. An unowned pin is the next
  flake.
- If `2.117.0` cannot start the stack on a teammate's machine (Docker version skew), pin forward to
  the next version that works on both machines rather than reverting to `latest`.

---

# Task C1 — Make the column lists literal so generated types can bind

**Implements:** specs §C, mechanical changes (1) and (2) · AD-11 · **Owner:** Scott
**Ideal days:** 0.25 · **Gated on:** nothing. **Blocks:** C2 — without this, generated types fix
nothing.

`supabase-js` parses the `.select()` string **at the type level**. TypeScript widens `'a' + 'b'` to
`string`, and a `string` select degrades inference to `GenericStringError`:

```
const EVENT_COLUMNS = 'id,owner_id,title,' + 'is_master,visibility';   // concatenated
client.from('events').select(EVENT_COLUMNS)
  -> TS2339 Property 'title' does not exist on type 'GenericStringError'
```

One single-quoted literal keeps the literal type and a misspelled column becomes a compile error.
**AD-11's claim that a renamed column becomes a compile error is true only after this task.** Land it
separately from C2 so the diff is reviewable as pure mechanics.

**Files**

- Modify `supabase/functions/occurrences/index.ts:141-144` — `EVENT_COLUMNS` becomes one literal.
- Modify `supabase/functions/notify-scheduler/index.ts:325-328` — same.
- Modify `supabase/functions/export/index.ts:27-28,32-33` — `MASTER_COLUMNS` and
  `EXCEPTION_COLUMNS` are already single literals; confirm by reading and leave them alone if so.
- Modify `supabase/functions/events/index.ts:346-348` — drop `.maybeSingle()` from the
  `rpc('override_occurrence', …)` call. The RPC returns a **composite**, not a set, so
  `.maybeSingle()` types `data` as `never`.

**Steps**

1. There is no new test: the existing 195-test integration suite is the test, and its job here is to
   prove the literal strings still name the columns the handlers read. Record the green baseline
   first — `pnpm test:integration` — so a later failure is attributable to this change.
2. Make the edits. Keep the byte content of each column list identical; only the concatenation goes
   away. Verify with a diff read, not by trusting the editor:
   `git diff -- supabase/functions | grep '^[-+].*COLUMNS' `.
3. Run the gates and paste each:
   - `deno check --config supabase/functions/deno.json */index.ts` from `supabase/functions`.
   - `deno lint` from `supabase/functions`.
   - `pnpm test:integration` in full — must still be 195 green. **A single failure here means a
     column name was altered in the retyping**, which is exactly the mistake this task is shaped to
     make visible.
4. Do **not** reformat these files with Prettier — they are Deno-formatted and outside the pnpm
   workspaces. If a line exceeds `deno.json`'s `lineWidth: 100`, break the string with a
   `+`-continuation **inside the same expression is not allowed** for the reason above; instead let
   the long literal exceed the width and add a `// deno-fmt-ignore` above it if `deno fmt --check`
   complains. `ci.yml` runs `deno lint`, not `deno fmt --check`, so this is cosmetic either way.

**Definition of done**

- `grep -n "COLUMNS =" -A 4 supabase/functions/occurrences/index.ts
supabase/functions/notify-scheduler/index.ts` shows one single-quoted literal per constant, with no
  `+`.
- `grep -n "maybeSingle" supabase/functions/events/index.ts` no longer matches line 348's
  `rpc('override_occurrence', …)` call — the other five `.maybeSingle()` calls are on `.from()`
  queries and stay.
- `deno check */index.ts` and `deno lint` green; `pnpm test:integration` still 195 green.

**Rollback**

Revert the commit. The behaviour is byte-identical either way — this task changes only what the type
checker can see — so a revert is risk-free and C2 simply cannot land afterwards.

**Risks that make it slip**

- Retyping a 16-column list by hand is where a typo lands. The integration suite catches it at
  runtime; `deno check` will not, because until C2 there are no generated types to check against.
  Run the suite, do not skip step 3.
- Dropping `.maybeSingle()` changes `data` from `Row | null` to `Row[]`-or-composite depending on the
  RPC's declared return. Read `20260904000001_override_occurrence_rpc.sql` to confirm it returns
  `setof`/composite before assuming; adjust the `if (!written)` guard to match.

---

# Task C2 — Generate, commit and gate the database types (T32)

**Implements:** specs §C, option 1 · AD-11, T32 · **Owner:** Scott · **Ideal days:** 0.75
**Gated on:** the CLI-pin decision (via C0) · **Depends on:** C0, C1.
**Blocks:** nothing hard, but **land it before D and G2** so their serializer edits inherit the types.

Twenty-two `as unknown as` casts in the Edge Functions (plus one explanatory comment at
`occurrences/index.ts:106`) hide every mismatch between a query and its row type. A cloud project now
exists and `supabase gen types typescript --local` produces a self-contained 1123-line `.ts` with no
imports, which Deno consumes directly — **no mirror step is needed**, unlike
`_shared/recurrence`.

**Files**

- Create `supabase/functions/_shared/database.types.ts` — generated, committed.
- Modify `supabase/functions/_shared/serialize.ts` — the six hand-written `*Row` interfaces
  (`EventRowFull`, `UserRow`, `FriendCodeRow`, `NotificationPreferenceRow`, `DeviceRow`, plus the
  event row the engine consumes) become `Database['public']['Tables'][…]['Row']` aliases.
- Modify `supabase/functions/_shared/ical.ts` — `IcalEventRow`, `IcalExceptionRow` become aliases.
- Modify `supabase/functions/_shared/variable.ts` — `VariableMasterRow`, `VariableExceptionRow`
  become aliases.
- Modify `supabase/functions/{events,me,occurrences,friend-code,export,notify-scheduler}/index.ts` —
  `createClient<Database>(…)`, and delete the casts.
- Modify `.github/workflows/ci.yml` — a drift step in the `integration` job, after `supabase start`.
- Modify `IMPLEMENTATION_PLAN.md` §1 AD-11 — record that the claim holds only with C1's literal
  column lists, which is the correction specs §C makes to it.

`supabase/functions/_shared/recurrence/row.ts` **stays as it is** — it is generated from the package
by `pnpm recurrence:sync`, `pnpm recurrence:check` fails on byte drift, and the probe shows the
generated `Row` is assignable to it. Never hand-edit anything under `_shared/recurrence`.

**Steps**

1. The deliverables are a generated file and a gate, so both "tests" are demonstrations. Record the
   pre-change count first: `grep -rn "as unknown as" supabase/functions --include=*.ts | grep -v
_shared/recurrence | wc -l` → paste the number (22 code hits plus the comment at
   `occurrences/index.ts:106`).
2. Generate the file: `pnpm db:start`, then
   `npx --yes supabase@2.117.0 gen types typescript --local > supabase/functions/_shared/database.types.ts`.
3. Retype the shared modules and the handlers, deleting each cast as its call site becomes typed.
   Two things the probes proved and you should expect: `client.rpc('override_occurrence', …)` now
   types `data` as the events composite so `mapEventRow(data)` and `toEventModel(data)` compile; and
   `select('*')` rows compile through the same mappers.
4. Run `deno check --config supabase/functions/deno.json */index.ts` from `supabase/functions` and
   record **0 errors**. This is the green run.
5. Watched fail (a) — the drift gate. Add the `ci.yml` step:

   ```yaml
   - name: Generated database types are in sync with the migrations
     run: |
       npx --yes supabase@2.117.0 gen types typescript --local \
         > supabase/functions/_shared/database.types.ts
       git diff --exit-code -- supabase/functions/_shared/database.types.ts
   ```

   Then prove it fails: hand-edit one line of `database.types.ts` (change a column's type from
   `string` to `number`), run the two commands locally in order, and record the non-zero exit and the
   diff output. Restore the file with `git checkout -- supabase/functions/_shared/database.types.ts`.
   Paste the red output.

6. Watched fail (b) — `deno check` catches a renamed column. Create a throwaway migration
   `supabase/migrations/29990101000000_probe_rename.sql` containing
   `alter table public.events rename column color_label to colour_label;`, run `pnpm db:reset`,
   regenerate the types, and run `deno check */index.ts`. Record the error at `serialize.ts`. Then
   **delete the probe migration**, `pnpm db:reset`, regenerate, and confirm `git diff --exit-code --
supabase/functions/_shared/database.types.ts` is clean again.
7. Run the surrounding gates and paste each: `deno lint`, `pnpm test:integration` in full (must stay
   195 green throughout — that is what proves the literal column strings from C1 still name real
   columns), `pnpm typecheck`, `pnpm recurrence:check`.

**Definition of done**

- `grep -rn "as unknown as" supabase/functions --include=*.ts | grep -v _shared/recurrence` returns
  **only** the explanatory comment at `occurrences/index.ts:106` — zero code hits. Update that
  comment too: it says the cast "is required, not laziness", which stops being true here.
- `deno check --config supabase/functions/deno.json */index.ts` → 0 errors.
- `ci.yml`'s `integration` job carries the drift step, and the PR body has the pasted red run from
  step 5.
- The pasted `deno check` error from step 6 shows a renamed column becoming a compile error, and
  `git status` confirms the probe migration is gone.
- `pnpm test:integration` green in full.

**Rollback**

Revert the commit; `git rm supabase/functions/_shared/database.types.ts` if the revert leaves it
behind, and remove the `ci.yml` step in the same revert — a drift gate with no committed file to
diff fails every run. The hand-written `*Row` interfaces come back with the revert, so the functions
compile again immediately. No migration is involved, so there is nothing forward-only to undo.

**Risks that make it slip**

- **PostgREST composite-return typing differs between supabase-js minors.** The Edge Functions import
  `https://esm.sh/@supabase/supabase-js@2` — an unpinned major. Pin it to an exact
  `@2.x.y` in the same PR, or step 4's clean `deno check` is only true until esm.sh serves a new
  minor.
- A CLI bump reformats the generated output and flaps the gate. That is what C0 exists to prevent;
  do not land C2 without it.
- The probe migration in step 6 must not survive. `git status` in the DoD is the check; a stray
  `29990101000000_probe_rename.sql` would break `pnpm db:reset` for everyone.

---

# Task F1 — Give `rotate_friend_code()` its own advisory lock

**Implements:** specs §F1, recommendation · **Owner:** Scott · **Ideal days:** 0.25
**Gated on:** nothing. **Blocks:** nothing, but it removes a coupling that T19's settings work is the
natural thing to break.

`rotate_friend_code()` serialises on the `public.users` row —
`perform 1 from public.users where id = v_user_id for update` — the only `FOR UPDATE` in the repo,
and there are no advisory locks anywhere. It works today and the 5× soak is clean. **The problem is
that the lock only exists if that `perform` matches a row under RLS.** Tightening
`users_update_self` (a column-restricted policy for T19's settings, say) makes it match zero rows,
the lock silently disappears, and the 1-in-3 race returns. It also makes "the `users` row is a mutex"
an undeclared convention; M6's friend-by-code redemption is the natural first feature to lock a
`friend_codes` row and then touch `users`, which is the deadlock pair.

**Files**

- Create `supabase/migrations/20260909000001_rotate_friend_code_advisory_lock.sql` — `create or
replace function public.rotate_friend_code()` with the `perform 1 from public.users … for update`
  replaced by
  `perform pg_advisory_xact_lock(hashtext('rotate_friend_code:' || v_user_id::text));`, everything
  else byte-identical to `20260903000005`'s body. Include the same `revoke`/`grant` lines that
  migration carries — a `create or replace` does not change grants, but restating them in the
  migration is §15's rule and makes the file self-describing.

**Steps**

1. There is no new test to write: `supabase/tests/src/friend-code.test.ts` already contains the
   eight-caller concurrency test that caught the original race, and it is the regression. Record the
   green baseline: `pnpm --filter @planpal/integration-tests test:integration -- friend-code`,
   **five consecutive runs**, all green. Paste the five summaries. One run is not evidence — this
   test was intermittent at roughly one in three before `20260903000005`.
2. Watched fail. Comment out the advisory lock line locally (edit the function in the database
   directly: `docker exec supabase_db_planpal psql -U postgres -c "create or replace function
public.rotate_friend_code() …"` with the `perform` removed), then run the concurrency test five
   times and record **at least one failure**. Paste it. Then `pnpm db:reset` to restore.
   A lock whose absence changes nothing observable is not a lock.
3. Write the migration, then `pnpm db:reset`.
4. Run the concurrency test five consecutive times again and record all five green.
5. Run the surrounding gates: `pnpm db:reset`, `pnpm test:integration` in full,
   `pnpm --filter @planpal/integration-tests test:integration -- grants` (the function's grants must
   be unchanged).

**Definition of done**

- `pnpm db:reset` exits 0 and lists `20260909000001_rotate_friend_code_advisory_lock.sql`.
- `friend-code.test.ts` green five consecutive runs, pasted.
- The step-2 red run is in the PR body.
- `docker exec supabase_db_planpal psql -U postgres -c "\sf public.rotate_friend_code"` shows
  `pg_advisory_xact_lock` and **no** `for update` on `public.users`.
- `grants.test.ts` green.

**Rollback**

Forward-only. The forward "down" migration is another `create or replace function
public.rotate_friend_code()` restoring `20260903000005`'s body verbatim. Note in the PR that
`20260903000003` and `20260903000005` both already define this function and were deliberately not
consolidated — `...005`'s commit message is the only record of why the obvious `FOR UPDATE` target
was wrong, so this migration makes three. Keep it that way; do not tidy.

**Risks that make it slip**

- `hashtext()` collides across different lock keys in principle. At two callers of this one key
  string it is irrelevant, but write the key with the function name as a prefix so a future second
  advisory lock cannot accidentally share the space.
- The step-2 watched fail is probabilistic. Five runs at ~1-in-3 gives roughly an 87 % chance of at
  least one failure; if five runs are all green, run five more before concluding the lock is
  unnecessary — and if ten are green, say so honestly in the PR rather than claiming a proof you did
  not get.
- If T19's settings work lands first and narrows `users_update_self`, the pre-existing race becomes
  live before this migration lands. That is the argument for doing it before T19, not after.

---

# Task F2a — Read the contract's `required` arrays at run time

**Implements:** specs §F2, part (a) · **Owner:** Scott · **Ideal days:** 0.25
**Gated on:** nothing. **This one has no prerequisites at all** and is the cheapest gate in the plan.

`contract-shape.test.ts` hardcodes `EVENT_REQUIRED` (13 names) and `OCCURRENCE_REQUIRED` (11).
Adding a required property to `openapi.yaml` regenerates `packages/types`, `contract.yml` stays
green, the serializer keeps omitting the new field, and **no test notices.** The next contract change
is G2's `isBirthday`, so the gap gets exercised within the week either way.

**Files**

- Modify `supabase/tests/src/contract-shape.test.ts` — replace the two hardcoded arrays with values
  read from `packages/api-contract/openapi.yaml` at run time
  (`components.schemas.Event.required` and `…EventOccurrence.required`). Keep `SNAKE_CASE_LEAKS`
  hardcoded — it is a denylist of things the spec deliberately does not mention, so it cannot be
  derived from the spec.
- Modify `supabase/tests/package.json` — add `yaml` as a devDependency. It is already present in the
  root `node_modules` (hoisted), so the import resolves today, but an undeclared dependency is a
  time bomb under a linker change.

**Steps**

1. Write the failing test. In `contract-shape.test.ts`, add
   `it('reads the required property list from openapi.yaml, not from a copy')`: parse the YAML,
   assert `Event.required` has at least 13 entries and includes `isVariableSchedule`, and assert the
   list the assertions use is the parsed one (e.g. by asserting a property the hardcoded array does
   not contain once G2 adds it). Then make `assertEventShape` iterate the parsed list.
2. Run and record the red run:
   `pnpm --filter @planpal/integration-tests test:integration -- contract-shape`. Expected
   `Cannot find package 'yaml'` if the dependency is not declared, then — after declaring it — the
   meaningful red run is the new `it(...)` failing because the assertions still read the constant.
   Paste both.
3. Make the change.
4. Run the test again and record it passing, and record `pnpm test:integration` in full still green.
5. Watched fail, and this is the point of the task: take a **local, uncommitted** copy of
   `openapi.yaml`, delete one entry from `Event.required` (say `visibility`), re-run
   `contract-shape`, and record that the suite still passes — then **add** a bogus required entry
   (`required: [… , notAThing]`) and record that the suite now **fails** with
   `missing required Event property notAThing`. Restore the file with
   `git checkout -- packages/api-contract/openapi.yaml`. Paste the failing output. That is the proof
   the gate fires the moment the contract gains a field the serializer omits.

**Definition of done**

- `grep -n "EVENT_REQUIRED\|OCCURRENCE_REQUIRED" supabase/tests/src/contract-shape.test.ts` shows
  both derived from the parsed YAML, with no literal name lists.
- The step-5 red run is in the PR body.
- `yaml` is declared in `supabase/tests/package.json`.
- `pnpm test:integration` green in full.

**Rollback**

Revert the commit and `pnpm install`. The hardcoded arrays come back and the gate returns to being
blind, which is the current state — safe, just less useful.

**Risks that make it slip**

- **Declaring `yaml` needs `pnpm add -D yaml --filter @planpal/integration-tests`, and the tool
  policy may refuse it.** If refused, stop and ask. The fallback, if the answer is "no new
  dependencies": add a `generate:required` script to `packages/api-contract` that uses the `yaml`
  already in its own dependency tree to emit a committed
  `packages/api-contract/required.generated.json`, add that file to `contract.yml`'s
  `git diff --exit-code`, and have the test import the JSON. Do not hand-roll a YAML parser.
- Reading a file from `supabase/tests` means a path relative to the test's own location. Resolve it
  from `import.meta.url`, not from `process.cwd()` — Vitest's cwd depends on how it was invoked.

---

# Task F2b — Generate a Deno-consumable `contract-types.ts`

**Implements:** specs §F2, part (b) · **Owner:** Scott · **Ideal days:** 0.5
**Gated on:** nothing · **Depends on:** C2 (the aliasing is only worth it once the row half is
generated too).

There are three copies of `Event` in the Edge Functions — `EventModel`/`EventRowFull`
(`serialize.ts`), the engine mirror's `EventRow`, `IcalEventRow`/`IcalExceptionRow` (`ical.ts`),
`VariableMasterRow`/`VariableExceptionRow` (`variable.ts`) — plus the spec's `Event`. C2 generates
the **row** shapes. This task generates the **wire** shapes, so `deno check` fails on a missing
required field before any test runs.

**Files**

- Create `supabase/functions/_shared/contract-types.ts` — generated from
  `packages/api-contract/openapi.yaml` with `openapi-typescript` (already a devDependency of
  `packages/api-contract`), emitted as a self-contained `.ts` with no imports, the same property
  `database.types.ts` has.
- Modify `packages/api-contract/package.json` — a second generate target, e.g.
  `"generate:edge": "openapi-typescript openapi.yaml --output ../../supabase/functions/_shared/contract-types.ts"`,
  and make `generate` run both so one command keeps both outputs in step.
- Modify `supabase/functions/_shared/serialize.ts` — `EventModel`,
  `ProfileModel`, `FriendCodeModel`, `NotificationPreferenceModel`, `DeviceModel` become
  `components['schemas']['Event']` and friends.
- Modify `.github/workflows/contract.yml` — extend the existing drift step's `git diff --exit-code`
  to cover `supabase/functions/_shared/contract-types.ts` alongside `packages/types/src/generated`.
- Modify `turbo.json` — the `generate` task's `outputs` gains the new path.

**Steps**

1. The deliverable is a generated file plus a gate, so both are demonstrations. Generate:
   `pnpm --filter @planpal/api-contract generate`. Confirm the output has no `import` statements
   (`grep -c "^import" supabase/functions/_shared/contract-types.ts` → 0); if it does, Deno cannot
   consume it and the file needs `--export-type` / a post-process step, which is a different task.
2. Retype the five `*Model` interfaces in `serialize.ts` as aliases.
3. Run `deno check --config supabase/functions/deno.json */index.ts` and record 0 errors.
4. Watched fail (a) — `deno check` catches a missing required field. In a **local, uncommitted** copy
   of `openapi.yaml`, add a bogus required property to `Event` (`required: [… , mustExist]` with
   `mustExist: {type: string}`), regenerate, and run `deno check */index.ts`. Record the error at
   `serialize.ts` — `toEventModel` no longer satisfies the type. Paste it, then
   `git checkout -- packages/api-contract/openapi.yaml` and regenerate.
5. Watched fail (b) — the drift gate. Hand-edit one line of `contract-types.ts`, run
   `pnpm --filter @planpal/api-contract generate` then
   `git diff --exit-code -- supabase/functions/_shared/contract-types.ts`, and record the non-zero
   exit. Restore with `git checkout --`.
6. Run the surrounding gates and paste each: `deno lint`, `pnpm test:integration` in full,
   `pnpm typecheck`, `pnpm --filter @planpal/api-contract validate`.

**Definition of done**

- `supabase/functions/_shared/contract-types.ts` exists, is committed, and has zero `import` lines.
- `pnpm --filter @planpal/api-contract generate` regenerates **both** outputs and leaves
  `git diff --exit-code` clean for both paths.
- `contract.yml` diffs both paths; the PR body carries the pasted red runs from steps 4 and 5.
- `deno check */index.ts` → 0 errors; `pnpm test:integration` green in full.
- Together with C2, `grep -c "interface .*Row" supabase/functions/_shared/serialize.ts` is 0 — both
  halves of the three-copies problem are closed.

**Rollback**

Revert the commit, `git rm supabase/functions/_shared/contract-types.ts`, and remove the
`contract.yml` path in the same revert (a gate diffing a deleted file fails every run). `serialize.ts`
returns to its hand-written model interfaces.

**Risks that make it slip**

- `openapi-typescript` emits `components['schemas'][…]` under a `components` type, so the aliases are
  a lookup rather than a direct name. Deno is fine with that; the readability cost is real, so add a
  local `type Event = components['schemas']['Event']` line at the top of `serialize.ts`.
- ESLint must ignore the new generated file the way it already ignores
  `packages/types/src/generated/**`. It lives under `supabase/`, which the pnpm workspaces do not
  lint, so no change should be needed — confirm with `pnpm lint` rather than assuming.
- If C2 has not landed, the row half is still hand-written and this task's value is halved. Order
  matters.

---

# Task D1 — Document the cron secrets and their vault entries

**Implements:** specs §D, "Recommendation" (documentation half) · **Owner:** Scott
**Ideal days:** 0.25 · **Gated on:** nothing · **Do first within D**, so D3's migration lands into a
documented setup rather than the reverse.

`CRON_SECRET` is consumed by `notify-scheduler` (§3 lists it) but is **missing from
`docs/SECRETS.md`'s inventory entirely**. The vault entries D3 reads do not exist anywhere in
documentation.

**Files**

- Modify `docs/SECRETS.md` — three new inventory rows: `CRON_SECRET` (used by
  `notify-scheduler` + the `pg_cron` job; server; never public; 90 days), `notify_function_url`
  (vault; the function URL per environment; not a secret but environment-specific; rotate on
  project change), `anon_key` (vault; public-safe; rotate with the project's anon key). Plus a short
  subsection "Vault secrets for the scheduler" giving the three `select vault.create_secret(…)`
  calls verbatim and naming the rotation owner for each.
- Modify `.env.example` — add `CRON_SECRET=` with a comment, per SECRETS.md's own "When a secret is
  added later" rule.
- Modify `docs/TESTING.md` — one line: local integration runs of the scheduler need
  `supabase/functions/.env` to carry `CRON_SECRET`, written before `supabase start`.

**Steps**

1. No test. The check is a grep-driven completeness assertion, run as the DoD below.
2. Write the three rows and the subsection. The three vault calls, per environment:

   ```sql
   select vault.create_secret('<https://<ref>.supabase.co/functions/v1/notify-scheduler>', 'notify_function_url');
   select vault.create_secret('<anon key>', 'anon_key');
   select vault.create_secret('<random 32+ chars>', 'cron_secret');
   ```

   and note that the **same** `cron_secret` value must also be set as a function secret
   (`supabase secrets set CRON_SECRET=…`), because the handler compares the header against its own
   env var, not against the vault.

3. Run `prettier --check --end-of-line auto docs/SECRETS.md docs/TESTING.md` — format only if both
   were clean at HEAD.

**Definition of done**

- `grep -n "CRON_SECRET" docs/SECRETS.md .env.example` matches in both files.
- `grep -n "notify_function_url\|anon_key" docs/SECRETS.md` matches the vault subsection.
- Every row names a rotation owner, per the file's existing convention.
- `docs/TESTING.md` tells a local runner how to make the scheduler test work.

**Rollback**

Revert the commit. Documentation only.

**Risks that make it slip**

- Writing a **value** into `docs/SECRETS.md` instead of a name. The file is committed and
  OneDrive-synced; it documents names and owners only. Never paste a real secret, a connection
  string, or an anon key into it.

---

# Task D2 — A local integration test for `notify-scheduler`

**Implements:** specs §D, "Local integration test" · **Owner:** Scott · **Ideal days:** 0.5
**Gated on:** nothing · **Depends on:** D1 (for the documented `.env` step) and, preferably, C2.
**Blocks:** D3 should not go live against a scheduler with zero tests.

`grep notify-scheduler supabase/tests/src` returns **nothing** — the scheduler, the component whose
Month 2 defect was "recurring events notified exactly once", has no test at all.

**Files**

- Create `supabase/tests/src/notify-scheduler.test.ts`.
- Modify `.github/workflows/ci.yml` — in the `integration` job, **before** `supabase start`, write
  the function env file: `echo CRON_SECRET=test-cron-secret > supabase/functions/.env`. The CLI reads
  that file when present and `.env*` is gitignored, so it must be created in CI rather than
  committed.

**Steps**

1. Write the failing tests. `supabase/tests/src/notify-scheduler.test.ts`:
   - `it('finds a candidate for a recurring event inside the lead window')` — create a user, register
     a device with a syntactically valid but fake Expo token, set a notification preference with a
     1-minute lead time, create a recurring event whose next occurrence is 90 s ahead, then
     `callFn('notify-scheduler', { method: 'POST', … })` with header `X-Cron-Secret:
test-cron-secret`. Assert `candidates >= 1`.
   - `it('suppresses a candidate inside quiet hours')` — same setup with quiet hours covering the
     occurrence; assert the candidate is suppressed.
   - `it('rejects a wrong X-Cron-Secret with 403')` — the watched fail for the auth path.
   - `it('returns 500 when CRON_SECRET is absent from the runtime')` — this is the **prerequisite
     hypothesis** made into a test: the handler's first branch returns
     `{"error":"Server misconfigured."}` with 500 when `CRON_SECRET` is unset. Run it once with
     `supabase/functions/.env` absent to confirm the file is what the runtime reads, then keep the
     test as an `it.skip` with a comment (it cannot coexist with the others in one stack run), or
     assert it in a separate spec that documents the manual procedure. **Do not leave a test that
     passes vacuously.**
2. Run and record the red run. First without the env file:
   `pnpm --filter @planpal/integration-tests test:integration -- notify-scheduler`. Expected: the
   first three tests fail with HTTP 500 `Server misconfigured.` Paste it — that failure is itself the
   evidence that the runtime does not yet have the secret.
3. Create the local env file — `echo CRON_SECRET=test-cron-secret > supabase/functions/.env` — then
   `pnpm db:stop && pnpm db:start` (the CLI reads the file at start; restarting the edge container
   alone will not pick it up).
4. Re-run step 2's command and record it passing. Confirm the 403 test now returns 403 rather than
   500 — that transition is the proof the file was picked up, and specs §D calls for exactly that
   observation.
5. Add the `ci.yml` step and run the surrounding gates: `pnpm test:integration` in full,
   `deno check --config supabase/functions/deno.json notify-scheduler/index.ts`,
   `pnpm typecheck`.

**Definition of done**

- All the `it(...)` titles above exist; the three live ones pass and the 500 case is recorded with
  its manual procedure rather than skipped silently.
- The 403 run and the 500 run are both pasted in the PR body — specs §D's DoD asks for both
  recorded failures explicitly.
- `ci.yml`'s `integration` job writes `supabase/functions/.env` before `supabase start`.
- `pnpm test:integration` green in full.
- A `console.log` of tick duration and candidate count is added to the handler, so M10's rewrite
  starts with data rather than guesses.

**Rollback**

Revert the commit and delete the local `supabase/functions/.env` (it is gitignored, so it will not
have been committed — confirm with `git status`). The scheduler returns to having no tests.

**Risks that make it slip**

- **The `.env` loading behaviour is a hypothesis until step 4.** If the CLI does not read
  `supabase/functions/.env` at this pinned version, the fallback is to pass the secret via
  `supabase start`'s environment or to accept `verify_jwt = false` locally (specs §D option 2), and
  the test's setup changes. Do not assume; observe the 500 → 403 transition.
- A fake Expo token returns `DeviceNotRegistered` and the `devices` row is **pruned**. That proves
  the dead-token path, not delivery — do not let a passing test here be read as "push works".
- Timing: an occurrence 90 s ahead with a 1-minute lead is a narrow window. Prefer computing the
  event's start from `now()` in the test rather than hardcoding a timestamp, or the spec becomes
  flaky at minute boundaries.

---

# Task D3 — Schedule `notify-scheduler` for real (T27)

**Implements:** specs §D, option 1 · §9, T27 · **Owner:** Scott · **Ideal days:** 0.75
**Gated on:** nothing · **Depends on:** D1, D2, C2 (so the handler's column list is already a
literal), and an operator with dashboard access to run `vault.create_secret` on dev.
**Blocks:** gate #3, T26-FCM, P8, and the usefulness of the dogfood window — without reminders the
app is a read-only calendar.

The schedule has never fired anywhere. `cron.job` is empty; `pg_net` is not installed locally.
Verified locally: a `net.http_post` with only `Content-Type` and `X-Cron-Secret` gets
`401 UNAUTHORIZED_NO_AUTH_HEADER` from the gateway, and `apikey: <anon>` **alone** is enough to reach
the function (the resulting 500 is the handler's own missing-`CRON_SECRET` branch, which is how we
know the request crossed Kong). The commented snippet in `20260614000002` is wrong twice: it reads
secrets with `current_setting('app.*')` (GUCs, not the vault) and it sends the **service-role key**
as the bearer, which §3 confines to function secrets.

**Files**

- Create `supabase/migrations/20260909000003_enable_notify_cron.sql`:

  ```sql
  create extension if not exists pg_net;

  select cron.schedule('notify-scheduler', '* * * * *', $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_function_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey',       (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
        'X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := '{}'::jsonb)
  $$);
  ```

  Secrets are read **at each tick**, so the migration can apply before an operator creates them;
  until then each tick records a visible failure rather than silently doing nothing.

- Modify `supabase/migrations/20260614000002_notification_scheduler.sql` — **no.** It has been
  applied; it is forward-only. Instead put a comment in the new migration saying that the commented
  snippet at `20260614000002:142-149` is superseded and why (GUCs vs vault, service-role vs anon).

**Steps**

1. Record the baseline: `docker exec supabase_db_planpal psql -U postgres -c "select * from
cron.job"` → empty. And
   `psql -c "select name, installed_version from pg_available_extensions where name in
('pg_cron','pg_net','supabase_vault')"` → `pg_cron 1.6.4` installed, `pg_net` **not** installed,
   `supabase_vault 0.3.1` installed. Paste both.
2. Write the migration, then `pnpm db:reset`.
3. Verify locally, and this is the local equivalent of a green test — paste all three:
   - `psql -c "select jobname, schedule from cron.job"` → one row named `notify-scheduler`.
   - Create the three vault secrets locally with the local function URL
     (`http://supabase_kong_planpal:8000/functions/v1/notify-scheduler`), the local anon key, and
     `test-cron-secret`. Wait two minutes.
   - `psql -c "select status, return_message from cron.job_run_details order by start_time desc
limit 5"` → `succeeded`.
   - `psql -c "select status_code, content from net._http_response order by id desc limit 5"` →
     `200` with a body containing `dispatched` and `candidates`.
4. Watched fail: set the local `cron_secret` vault entry to a wrong value, wait one tick, and record
   `net._http_response.status_code = 403`. Then restore it. A schedule whose failures are invisible
   is the thing this task exists to replace.
5. Verify on **`planpal-dev`** (project ref `dhsfivkumctnstziokmu`), which is the only cloud target
   this task touches. An operator runs the three `vault.create_secret` calls from D1 and
   `supabase secrets set CRON_SECRET=…` for the function. Then the same three SQL layers, ten
   consecutive minutes:
   - layer 1 — `cron.job_run_details` shows `succeeded` for ten ticks.
   - layer 2 — `net._http_response` shows `200` with `{"dispatched":N,"candidates":M,…}`.
   - layer 3 — register a device row and create an event two minutes ahead;
     `select * from notification_sends` gains a row with that `event_id` and `occurrence_date`.
6. **Confirm or refute the hypothesis:** specs §D assumes the **cloud** gateway accepts `apikey`
   alone as the local one does. All seven functions on `planpal-dev` are deployed with
   `verify_jwt: true` (verified). The proof is layer 2 showing `200` on the first scheduled request.
   **If it is 401, fall back to option 2 the same day**: add
   `[functions.notify-scheduler] verify_jwt = false` to `supabase/config.toml`, redeploy, and let
   the `X-Cron-Secret` check be the only gate. Record which branch was taken.
7. Run the surrounding gates: `pnpm db:reset`, `pnpm test:integration` in full (D2's spec must stay
   green with the schedule present), `deno check --config supabase/functions/deno.json */index.ts`.

**Definition of done**

- `pnpm db:reset` exits 0 and `cron.job` has exactly one row named `notify-scheduler`.
- On `planpal-dev`: layers 1 and 2 show `200`s for ten consecutive minutes, pasted; layer 3 shows a
  `notification_sends` row for a test event, pasted.
- The step-4 403 red run is in the PR body, and step 6's branch is recorded in writing.
- `notify-scheduler.test.ts` (D2) green.
- `docs/SECRETS.md` lists `CRON_SECRET`, `notify_function_url` and `anon_key` with rotation owners
  (D1).
- **What this does not prove:** delivery. A fake Expo token yields `DeviceNotRegistered` and the row
  is pruned. A real Expo push token from a T25-Android dev build is the only proof of delivery, and
  that is gate #3.

**Rollback**

Forward-only. The forward "down" migration is
`select cron.unschedule('notify-scheduler');` — and leave `pg_net` installed; dropping an extension
other things may come to use is a bigger change than the schedule it was added for. On a cloud
environment, `cron.unschedule` plus deleting the three vault secrets fully stops it. If the schedule
misbehaves in production, `cron.unschedule` is the emergency stop and it needs no deploy.

**Risks that make it slip**

- **Cloud vault permissions.** Creating vault secrets on `planpal-dev` needs dashboard access; the
  specs plan could not verify whether `pg_net` is even enabled there or whether any vault secrets
  exist. Both are unknowns until step 5.
- The `apikey`-alone hypothesis (step 6). Option 2 is an acceptable second choice and the fallback is
  same-day, but it makes the function reachable from the internet up to the secret check — say so in
  the PR rather than treating it as equivalent.
- A per-minute schedule that errors writes a row per minute to `net._http_response`. Check the
  table's growth after the ten-minute window; the scheduler already has retention pruning for
  `notification_sends` but `net._http_response` is pg_net's own table.
- Scale: per tick the function loads all enabled prefs, their devices and users, and every master
  with `utc_start` before the horizon, over a window of at most 30 days. At 200 users that is a few
  hundred rows and tens of milliseconds. **Confirmed not worth pre-empting** — the M10 materialised
  queue stands. Do not optimise it here.

---

# Task T30 — Backup cadence and a tested restore

**Implements:** specs §I "T30 specification (start now)" · §12 T30 · MVP gate #7 · **Owner:** Scott
**Ideal days:** 1.5 · **Gated on:** nothing. **Start early.** It has no dependency on any
other task in this plan and it is the only gate criterion that can be closed immediately, so leaving
leaving it to the end means P12 carries risk it does not have to.

**Files**

- Modify `docs/BOOTSTRAP.md` — a "Backup and restore" section recording the plan tier, the cadence,
  the rehearsal procedure, and the dated result with its duration and every manual step.
- Modify `docs/ENVIRONMENTS.md` — one line per environment stating its backup posture.

**Steps**

1. Confirm the plan tier first, and write down which it is. Supabase's free tier has **no** automated
   backups; Pro gives daily backups with PITR as an add-on. The cadence you can document depends on
   the answer, and if `planpal-dev` is free-tier then the honest statement is "no automated backups
   on dev; prod requires Pro before external testers", which is itself a finding for I1.
2. Take the dump: `npx --yes supabase@2.117.0 db dump --project-ref dhsfivkumctnstziokmu -f dump.sql`
   (schema) and again with `--data-only -f dump-data.sql`. Both files are gitignored scratch —
   confirm `git status` stays clean.
3. Restore into a **fresh local stack** on a clean project id, then load both dumps with
   `docker exec -i supabase_db_planpal psql -U postgres < dump.sql`.
4. Verify the restore, and this is the part that makes it a tested restore rather than a copied file:
   - Row counts per public table, before and after:
     `psql -c "select relname, n_live_tup from pg_stat_user_tables where schemaname='public' order by relname"`.
     Paste both sides.
   - Run `grants.test.ts` and `rls.test.ts` **against the restored database** —
     `pnpm --filter @planpal/integration-tests test:integration -- grants` and `-- rls`. A restore
     that loses a policy or a revoke is a restore that reopens every hole M2 closed, and nothing else
     in this procedure would notice.
5. Record the date, the wall-clock duration, and every manual step in `docs/BOOTSTRAP.md`. Delete
   `dump.sql` and `dump-data.sql`.

**Definition of done**

- `docs/BOOTSTRAP.md` carries a dated restore record with duration and manual steps — MVP gate #7's
  evidence is "a completed test restore, dated", so the date is not decoration.
- The pasted before/after row counts match.
- `grants.test.ts` and `rls.test.ts` green against the restored database, pasted.
- The plan tier is stated, and if automated backups are not available on the tier in use, that is
  written down as an open item for I1 rather than left implied.
- `git status` clean — no dump files committed.

**Rollback**

Nothing to roll back: the rehearsal is read-only against the cloud project and writes only to a
throwaway local stack. If the documentation commit needs reverting, revert it; the rehearsal still
happened, so re-record it rather than redo it.

**Risks that make it slip**

- The dump may contain user data from `planpal-dev`. It is a dev project with throwaway data, but
  **do not** attach a dump to a PR, a ticket, or the Obsidian vault, and do not paste row contents
  into the record — counts and table names only.
- `supabase db dump` needs the project's database password. That is a secrets-store lookup, not a
  guess.
- A restore that needs a manual step is still a valid restore, but an **undocumented** manual step
  makes the rehearsal worthless at 3am. Write every one down, including the ones that felt obvious.

---

# Task T7 — Auth screens, session persistence and route guards

**Implements:** §4 client, §P1 · **Owner:** Arlo · **Ideal days:** 3
**Gated on:** nothing — **B does not wait on T6, and neither does this.** Email/password already
works on the cloud project; the OAuth buttons need T6 (Google provider) but the screens, the session
and the guards do not. Build email/password first and leave the OAuth handlers wired but disabled
behind a flag until T6 lands. **Depends on:** B2. **Blocks:** T18, T19, H3.

**Files**

- Create `apps/mobile/src/lib/session/secureStore.ts` — the `SessionStore` implementation over
  `expo-secure-store`, delegating chunking to `@planpal/api-client` (B2 owns the chunking; this file
  owns the platform calls).
- Create `apps/mobile/src/lib/planpalClient.ts` — the composition root: `createPlanPalClient` with
  the secure store, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Create `apps/mobile/app/sign-in.tsx`, `apps/mobile/app/sign-up.tsx`,
  `apps/mobile/app/forgot-password.tsx`, `apps/mobile/app/auth/callback.tsx`.
- Modify `apps/mobile/app/_layout.tsx` — an `expo-router` layout guard: unauthenticated users are
  redirected away from the calendar routes.
- Create `apps/web/src/lib/planpalClient.ts` — the same composition root using supabase-js's default
  localStorage storage (AD-9) and `NEXT_PUBLIC_SUPABASE_*`.
- Create `apps/web/src/app/sign-in/page.tsx`, `sign-up/page.tsx`, `forgot-password/page.tsx`,
  `auth/callback/page.tsx`.
- Modify `apps/web/src/app/layout.tsx` (or add `middleware.ts`) — the web-side guard.
- Modify `apps/mobile/package.json` — `expo-secure-store` via `expo install` (not `pnpm add`, so the
  SDK 53 pin is respected).
- Modify `.env.example` — the four public variables, if any are missing.

**Steps**

1. Write the failing tests. This task lands after H1/H2 only if those are already done; if they are
   not, the runners do not exist yet, so the tests here are the **integration** kind:
   - `supabase/tests/src/auth-flow.test.ts`, `it('a fresh sign-up produces users, notification_preferences and friend_codes rows')` —
     sign up through GoTrue with a new email, then assert one row in each of the three tables via
     `./db`. This is §P1's exit criterion and it is not currently asserted anywhere.
   - `packages/api-client/src/auth.test.ts` gains
     `it('restores a session from the store on cold start')` — a new client constructed over a
     pre-populated store resolves `getSession()` to that session without a network call.
2. Run and record the red runs:
   `pnpm --filter @planpal/integration-tests test:integration -- auth-flow` and
   `pnpm --filter @planpal/api-client test auth`. Paste both.
3. Build the screens and the guards. Screens call `client.auth.*` only — **never** `supabase-js`,
   which B5's lint rule now enforces.
4. Re-run both test commands and record them passing.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (which now
   includes the mobile export gate from A2), `pnpm test:integration`.
6. Manual verification, which the automated tests cannot replace: sign in on web and on a device or
   emulator; force-quit the app and confirm the session survives a cold start; let an access token
   expire (or mint an expired one as in B6) and confirm the refresh is invisible to the user; try to
   reach a calendar route while signed out and confirm the redirect.

**Definition of done**

- Email/password sign-up, sign-in and forgot-password work on web **and** on a physical device or
  emulator.
- The session survives a cold start on both platforms — demonstrated, not inferred.
- An expired access token refreshes without the user noticing (B6 proves the client's half; this
  proves the app's).
- An unauthenticated user cannot reach a calendar route on either platform.
- A new sign-up produces a complete `users` + `notification_preferences` + `friend_codes` row set,
  asserted by `auth-flow.test.ts`.
- Google and Apple buttons exist but are explicitly disabled with a visible reason until T6/T3 land.
  A button that silently does nothing is worse than an absent one.

**Rollback**

Revert the commit. The new route files are additive; the `_layout.tsx` guard and the web layout/
middleware change are the two edits that touch existing behaviour, so revert those with it.
`expo-secure-store` stays in the lockfile harmlessly, or comes out with a `pnpm install`.

**Risks that make it slip**

- `supabase/config.toml` has `enable_confirmations = true`, so a real sign-up needs the confirmation
  email. Locally that is Mailpit at `http://127.0.0.1:54324`; H3 automates fetching the link. Do not
  turn confirmations off to make a screen easier to test.
- The OAuth deep link is `planpal://auth/callback` and the scheme is already in `app.json`. Deep
  links do not work in a web browser preview, so the callback route cannot be verified without a
  device or emulator.
- The iOS Keychain 2048-byte limit will not show up in Android-only dogfooding (B2's Risks). If the
  team is Android-only, this stays a latent iOS bug — record it rather than closing it.

---

# Task T18 — Mobile on real data

**Implements:** §P3, §12 T18 · **Owner:** Arlo · **Ideal days:** 2
**Gated on:** nothing · **Depends on:** A1/A2 (the app must bundle), B3, B4, T7.
**Blocks:** T25-Android's usefulness, T29, dogfooding, gate #4.

`apps/mobile/app/index.tsx:26` still holds `STUB_EVENTS`. Delete it.

**Files**

- Modify `apps/mobile/app/index.tsx` — delete `STUB_EVENTS` (lines 26 and 78) and read
  `client.occurrences.range(from, to)` for the visible window.
- Modify `apps/mobile/src/components/event/CreateEventForm.tsx` — submit through
  `client.events.create`.
- Modify `apps/mobile/src/components/calendar/DayTimeSheet.tsx` — occurrence edit through
  `client.events.overrideOccurrence`, cancel through `client.events.cancelOccurrence`.
- Modify `apps/mobile/src/components/calendar/EventBar.tsx` — **`eventColor` currently returns
  `event.colorLabel` verbatim**, so React Native receives `'__birthday__'` as a colour and most
  likely renders transparent with a warning. After G2 this branches on `isBirthday`; until G2 lands,
  guard the sentinel explicitly rather than shipping an invalid colour string.
- Modify `apps/mobile/app/_layout.tsx` — register the push token on launch via
  `client.devices.register(token, 'android')`.
- Create `apps/mobile/src/lib/emptyStates.tsx` — the explicit no-events / failed-load / offline /
  permission-denied states §P4 calls out as work rather than polish.

**Steps**

1. Write the failing tests. The mobile runner is H2, so if H2 has not landed the honest test here is
   an integration one plus recorded manual verification. Either way write:
   - `apps/mobile/src/lib/occurrenceWindow.test.ts`, `it('asks the client for the whole visible month, not the visible days')` —
     pure function extracted from `index.tsx` that turns a calendar view state into a `(from, to)`
     pair. Extracting it is what makes this testable at all, and per AD-3 that logic belongs in a
     package if web needs it too.
   - `it('never passes a sentinel colour string to a native colour prop')` in a component test over
     `EventBar` (needs H2), or as an assertion in `occurrenceWindow.test.ts` over a pure
     `eventColor(event)` helper extracted from the component. **Prefer the extraction** — it is
     testable without a renderer and it is the same fork-prevention argument as AD-3.
2. Run and record the red run: `pnpm --dir apps/mobile test` (after H2) or
   `pnpm --dir apps/mobile exec vitest run occurrenceWindow` (before it). Paste it.
3. Make the changes, deleting `STUB_EVENTS` in the same commit that introduces the real read — do
   not leave both paths in the file behind a flag.
4. Re-run and record passing.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
6. Manual verification against the **local** stack first, then dev: create an event → see it on the
   calendar → edit one occurrence → cancel one occurrence. Do it with a **recurring** event, not a
   one-off: PR #3's defects 3, 11 and 13 were all in the recurring/exception paths, and a one-off
   exercises none of them.

**Definition of done**

- `grep -rn "STUB_EVENTS" apps/mobile` returns nothing.
- Create → see → edit one occurrence → cancel one occurrence, on a device or emulator, against dev,
  with a recurring event. Screenshots or a screen recording attached.
- A `devices` row exists for the phone after launch
  (`psql -c "select platform, last_seen_at from public.devices"`).
- Empty, error, offline and permission-denied states all reachable and rendered — demonstrate each,
  do not just implement them.
- No response rendered on the calendar contains `__birthday__` as a colour.

**Rollback**

Revert the commit. `STUB_EVENTS` returns and the app renders fake data again, which is a working
state. Nothing persists server-side beyond whatever the manual verification created — delete those
rows or leave them; dev data is throwaway.

**Risks that make it slip**

- Sensitive-public rendering is a **presentation** concern here: a grey `busyBlock` with time and
  duration only, in the **owner's own view**. Server-side redaction is M7 and must land before any
  shared view reaches a tester. Do not let this task imply privacy is enforced.
- `MAX_RANGE_DAYS = 180` means a wide month-swipe range can 400. B3 chunks it; verify by swiping fast
  across a year rather than assuming.
- Without A1/A2 the app cannot bundle, so none of this is verifiable. That is the whole reason A is
  task 1.

---

# Task T20 — Web read-only calendar

**Implements:** §P5, §12 T20 · **Owner:** Arlo · **Ideal days:** 4
**Gated on:** nothing · **Depends on:** B3, T7, and `packages/calendar-core` (already extracted —
94 tests at 99.15 % lines). **Blocks:** T28, H3 stage 1.

Web becomes a usable dev/test environment. **Event management on web is deliberately M4 (T28)** —
do not quietly re-expand this. `apps/web/src/app/page.tsx` is still the Phase 3 scaffold.

**Files**

- Create `apps/web/src/components/calendar/MonthGrid.tsx`, `WeekStrip.tsx`, `DayTimeSheet.tsx`,
  `EventBar.tsx` — DOM views over `@planpal/calendar-core`. **Markup is written twice; logic is
  not** (AD-3). If a rule appears in both a web `.tsx` and a mobile `.tsx`, it belongs in
  `calendar-core`.
- Create `apps/web/src/app/calendar/page.tsx` — the signed-in calendar route.
- Modify `apps/web/src/app/page.tsx` — redirect signed-in users to `/calendar`.
- Modify `apps/web/package.json` — add `@planpal/calendar-core` and `@planpal/api-client` as
  workspace dependencies.

**Steps**

1. Write the failing tests (needs H1's runner, so land H1 first or accept these as the reason to):
   `apps/web/src/components/calendar/MonthGrid.test.tsx`:
   - `it('renders 42 cells for any month')` — six weeks by seven days, from
     `buildMonthGrid(year, month)`; `calendar-core` already guarantees 6×7.
   - `it('places an occurrence on its own date and nowhere else')`
   - `it('renders a moved override at its overridden time, not the master time')` — the assertion
     that matters; PR #3's defects were all in this area.
2. Run and record the red run: `pnpm --dir apps/web test`. Paste it.
3. Build the views and the route.
4. Re-run and record passing.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — `next build`
   must stay green.
6. Verify by hand: sign in on web against the local stack, see the same calendar the phone shows, in
   all three views, with hover, keyboard navigation and a sensible focus order (§P5's desktop
   interactions are part of the task, not extra).

**Definition of done**

- Web renders the signed-in user's real calendar in month, week-strip and day-time-sheet views,
  against dev.
- **No React Native dependency in the Next.js bundle** — check it, do not assume:
  `grep -rn "react-native" apps/web/src` returns nothing, and
  `pnpm --filter @planpal/web build` output contains no `react-native-web` chunk.
- The three named `it(...)` titles pass.
- `next build` green; `pnpm lint` and `pnpm typecheck` green.

**Rollback**

Revert the commit. The new component and route files are additive; only `page.tsx`'s redirect touches
existing behaviour.

**Risks that make it slip**

- **This is the most underestimated line in the original plan** (§Risks): none of the M2 calendar
  runs in Next.js. Four ideal days assumes `calendar-core` really does hold all the maths — verify
  that early by trying to render the month grid before building anything else, and if a view needs
  logic that is not in the package, add it to the package with tests rather than to the component.
- If the capacity warning bites, this is the task whose slip pushes T28 past freeze. §Risks says: if
  something must give, take it from P5 (web) before P7 (tests).
- Server components and `localStorage`-backed sessions do not mix. The calendar route needs to be a
  client component or the session read has to move to a route handler; decide that first, not after
  building three views.

---

# Task H1 — A real test runner for `apps/web`

**Implements:** specs §H, web runner option 1 · §P7, §12 T23 · **Owner:** Arlo · **Ideal days:** 0.5
**Gated on:** nothing. **Blocks:** T20's tests, H3.

Neither app has a `test` script, so `turbo run test` skips both. `@testing-library/*`, `jsdom` and
`happy-dom` are not installed anywhere; `vitest@2.1.3` and `@vitest/coverage-v8` are, at the root.

**Files**

- Create `apps/web/vitest.config.ts` — `environment: 'jsdom'`,
  `include: ['src/**/*.test.tsx', 'src/**/*.test.ts']`. **No coverage threshold**: docs/TESTING.md
  puts app UI behind component + E2E tests rather than a line target, and a number with nothing
  behind it is worse than none. Say that in a comment so the next reader does not "fix" it.
- Modify `apps/web/package.json` — `"test": "vitest run"`, plus devDependencies
  `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`.
- Create `apps/web/src/components/Button.test.tsx` — at least one real test, so the script is not
  vacuous.

**Steps**

1. Write the failing test. `apps/web/src/components/Button.test.tsx`:
   `it('renders its label and calls onPress when clicked')` — render the existing
   `apps/web/src/components/Button.tsx`, assert the label text is in the document, fire a click,
   assert the handler ran.
2. Run and record the red run: `pnpm --dir apps/web test`. Expected
   `Missing script: "test"` before the script exists, then
   `Cannot find package '@testing-library/react'`. Paste both — the first is the state this task
   exists to end.
3. Install the three devDependencies, add the config and the script.
4. Re-run and record passing.
5. Run the surrounding gates: `pnpm test` from the root — **Turbo must now list
   `@planpal/web#test`**, which is the observable change; then `pnpm lint`, `pnpm typecheck`.

**Definition of done**

- `pnpm test` from the repo root lists `@planpal/web#test` and it passes with a non-empty suite.
- `pnpm --dir apps/web test` exits 0.
- `apps/web/vitest.config.ts` carries the comment explaining the deliberate absence of a coverage
  threshold.

**Rollback**

Revert the commit and `pnpm install`. `turbo run test` skips web again.

**Risks that make it slip**

- Needs three installs — the `pnpm add` policy applies (see A1). Stop and ask if refused.
- `jsdom` vs `happy-dom`: pick `jsdom`, because Testing Library's docs and every error message assume
  it. Do not spend the day comparing them.
- Next.js App Router components can import server-only modules. Keep component tests to leaf
  components (`Button`, `Text`, the calendar views) and leave routes to Playwright.

---

# Task H2 — A test runner for `apps/mobile` (`jest-expo`)

**Implements:** specs §H, mobile runner option 1 · **Owner:** Arlo · **Ideal days:** 1
**Gated on:** **Decision D-H** (recommended: `jest-expo`, as the one documented exception to the
one-runner rule). **Do not start this task until D-H is answered** — introducing a second test
runner is exactly what CLAUDE.md says to ask about first. **Depends on:** A1.

Vitest cannot transform React Native's untranspiled Flow sources, so the alternative (option 2:
Vitest scoped to `src/lib/**` and pure hooks, with A2's bundle gate as the "test") leaves component
rendering untested on the platform that matters most, until Playwright can reach it — and Playwright
cannot reach mobile at all.

**Files**

- Create `apps/mobile/jest.config.js` — `preset: 'jest-expo'`, `transformIgnorePatterns` covering the
  pnpm-hoisted `node_modules` layout, `testMatch` for `src/**/*.test.tsx` and `**/*.test.ts`.
- Modify `apps/mobile/package.json` — `"test": "jest"`, devDependencies `jest-expo`, `jest`,
  `@types/jest`, `@testing-library/react-native`.
- Create `apps/mobile/src/components/Button.test.tsx` — one real component test.
- Modify `docs/TESTING.md` — record the decision: the workspace now has **three** runners (Vitest,
  `node:test` for `@planpal/recurrence`, `jest-expo` for `apps/mobile`), why the third exists, and
  that `apps/mobile` is the only place it applies. The file's existing "two runners (to consolidate)"
  section is now wrong and must be updated, not appended to.
- Modify `apps/mobile/deps.test.ts` (from A1) — move it under the new runner so it is not orphaned.

**Steps**

1. Write the failing test. `apps/mobile/src/components/Button.test.tsx`:
   `it('renders its label and calls onPress when pressed')` over the existing
   `apps/mobile/src/components/Button.tsx`.
2. Run and record the red run: `pnpm --dir apps/mobile test`. Expected `Missing script: "test"`, then
   after adding it, a transform error naming a `node_modules` path — which is the real work of this
   task. Paste both.
3. Install and configure. The `transformIgnorePatterns` are the whole difficulty: the repo uses
   `node-linker=hoisted` (Expo requires it), so the default pattern that assumes a nested layout will
   not match. Iterate until the transform succeeds.
4. Re-run and record passing.
5. Run the surrounding gates: `pnpm test` from the root — Turbo must now list
   `@planpal/mobile#test`; then `pnpm lint`, `pnpm typecheck`, `pnpm build`.

**Definition of done**

- `pnpm test` from the root lists **both** `@planpal/web#test` and `@planpal/mobile#test`, and both
  pass with non-empty suites. That is specs §H's DoD bullet, checked by reading Turbo's output.
- `docs/TESTING.md`'s runner section describes three runners accurately, with the D-H decision and
  its date.
- `apps/mobile/deps.test.ts` runs under the mobile runner.

**Rollback**

Revert the commit and `pnpm install`. `turbo run test` skips mobile again, and `deps.test.ts` needs
its invocation restored to the root Vitest binary.

**Risks that make it slip**

- **`jest-expo` transform configuration in a pnpm-hoisted monorepo routinely costs an extra day.**
  Specs §H budgets 3 days for all of H against the plan's 2 for exactly this reason. If it runs past
  a day, this is the first task on the descope list after T24.
- Three runners means three coverage reports and three watch modes. That cost is accepted by D-H;
  do not try to unify them in the same task.
- The `pnpm add` policy applies.

---

# Task H3 — Playwright stage 1

**Implements:** specs §H, "Playwright journey", stage 1 only · **Owner:** Arlo · **Ideal days:** 1.5
**Gated on:** nothing · **Depends on:** T7 and T20. **Do not schedule the full §P7 journey in Month
3** — the journey as written (sign up → create a recurring event → override one → see it) needs a web
event form, which is T28 in Month 4. Stage 2 is a separate Month 4 task below.

**Stage 1 scope:** sign in on web → the calendar shows a recurring event with one override at its
moved time and one cancelled date absent. **The event and its override are seeded through the API**
(the integration harness's `callFn`), because web has no event form yet. Sign-up is one separate
test that fetches the confirmation link from Mailpit's API and follows it.

**Files**

- Create `apps/web/playwright.config.ts` — `webServer` starting `next dev` with
  `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the demo anon key; `projects: [chromium]`;
  `storageState` reused from a setup project.
- Create `apps/web/e2e/auth.setup.ts` — create a test user through the GoTrue admin API, sign in
  through the **real UI** once, save `storageState`.
- Create `apps/web/e2e/calendar.spec.ts` — the stage 1 assertions.
- Create `apps/web/e2e/signup.spec.ts` — the Mailpit confirmation-link test.
- Modify `apps/web/package.json` — `"e2e": "playwright test"`, devDependency `@playwright/test`.
- Modify `.github/workflows/ci.yml` — a new `e2e` job after `integration`, reusing a started stack,
  with `npx playwright install --with-deps chromium`.
- Modify `docs/TESTING.md` — record the **two-stage** journey, so §P7's single-journey wording stops
  being read as a Month 3 commitment.
- Modify `MONTH_3_4_PLAN.md` §P7 — same correction at the source.

**Steps**

1. Write the failing tests. `apps/web/e2e/calendar.spec.ts`:
   - `it('shows a moved override at its overridden time')` — seed a weekly master and a `PATCH`
     override moving one occurrence to 11:00, then assert the page shows `11:00` for that date.
     **Assert on the moved time text**, not on "the page loaded".
   - `it('does not show a cancelled occurrence')` — seed a cancel for one date and assert that
     date's cell has no event.
     `apps/web/e2e/signup.spec.ts`:
   - `it('completes a sign-up by following the Mailpit confirmation link')` —
     `GET http://127.0.0.1:54324/api/v1/messages`, extract the link, follow it, assert the signed-in
     state.
2. Run and record the red run: `pnpm --dir apps/web e2e`. Expected
   `Cannot find package '@playwright/test'`, then a failure on the first assertion. Paste both.
3. Install, configure, implement.
4. Re-run and record passing.
5. Watched fail, and this is specs §H's explicit DoD requirement: change the seeded override time
   from 11:00 to 10:00 **in the test's seed only**, re-run, and record that the assertion fails.
   Restore it. Paste the red output. An E2E test that passes against the wrong data is the most
   expensive kind of false confidence.
6. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

**Definition of done**

- Stage 1 passes in CI against the **local stack** (docs/TESTING.md forbids tests against a cloud
  project — that is not negotiable here).
- The step-5 red run is in the PR body.
- `ci.yml` has an `e2e` job that runs after `integration` and installs Chromium.
- `docs/TESTING.md` and `MONTH_3_4_PLAN.md` §P7 both describe two stages.

**Rollback**

Revert the commit, `pnpm install`, and remove the `e2e` job in the same revert. The `e2e` job is
additive to CI, so nothing else regresses.

**Risks that make it slip**

- **Mailpit's API shape** is a hypothesis until step 4 — `GET /api/v1/messages` is the documented
  endpoint but the message body's link extraction is version-specific. If it fights back, the fallback
  is to confirm the user through the GoTrue admin API (`email_confirm: true`, as `harness.ts` already
  does) and keep the Mailpit test as a separate, clearly-labelled optional spec.
- `next dev` startup time in CI. Give `webServer` a generous `timeout` and reuse the server across
  specs rather than per spec.
- Reusing the `integration` job's stack means job ordering and a shared runner. If that proves
  awkward, start a second stack in the `e2e` job — slower, but independent.

---

# Task T24 — Mobile Sentry and PostHog config plugins

**Implements:** §12 T24 · specs §I · **Owner:** Arlo · **Ideal days:** 1
**Gated on:** nothing · **Depends on:** A1 (installing anything into `apps/mobile` needs the pins
right first). **First on the descope list** if Arlo's line overruns — see the capacity warning.

`apps/mobile/src/lib/observability.ts` exists but native mobile observability is a no-op until the
config plugins are wired (`docs/BOOTSTRAP.md`, Phase 3 status). Crash-free sessions is an MVP
baseline KPI that currently cannot be measured on the platform that matters most.

**Files**

- Modify `apps/mobile/app.json` — the `plugins` array gains `@sentry/react-native/expo` and the
  PostHog plugin, configured from `EXPO_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_POSTHOG_KEY` (both already
  in `turbo.json`'s `globalEnv`).
- Modify `apps/mobile/package.json` — `@sentry/react-native` and `posthog-react-native` via
  `expo install`.
- Modify `apps/mobile/src/lib/observability.ts` — initialise both, guarded on the env vars being
  present so a local run without them is silent rather than crashing.
- Modify `docs/BOOTSTRAP.md` — the Phase 3 "still manual" note stops claiming the plugins are
  unwired.

**Steps**

1. Write the failing test.
   `apps/mobile/src/lib/observability.test.ts`, `it('initialises nothing and throws nothing when the DSN is absent')`
   and `it('initialises Sentry once when the DSN is present')` with the SDK mocked. Needs H2's
   runner; if H2 is not done, this task waits or the test moves to a pure helper.
2. Run and record the red run: `pnpm --dir apps/mobile test observability`. Paste it.
3. Install, configure `app.json`, implement the guarded init.
4. Re-run and record passing.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm build` (the A2 export gate must
   still pass — a config plugin that breaks the bundle is the failure mode here), `pnpm test`.
6. Verify on a dev build: trigger a handled exception and confirm it appears in Sentry; confirm one
   PostHog event lands. **A config plugin only takes effect in a native build**, so this cannot be
   verified in Expo Go — it is verified as part of T25-Android.

**Definition of done**

- A deliberate test exception from the dev-client build appears in the Sentry project, with a
  screenshot or event link.
- One analytics event from `@planpal/analytics` appears in PostHog.
- `pnpm build` still green — the mobile export gate is the regression detector.
- `docs/BOOTSTRAP.md` no longer says native mobile observability is a no-op.

**Rollback**

Revert the commit and `pnpm install`. `app.json`'s plugin array returns to its prior state, which is
the safe default — an unconfigured plugin array cannot break a build.

**Risks that make it slip**

- Config plugins run at prebuild and can break the native build in ways `expo export` does not see.
  T25-Android is where that surfaces, so sequence this **before** T25 rather than after, or plan to
  debug two changes at once.
- Sentry and PostHog projects do not exist yet (`docs/BOOTSTRAP.md`: "still manual"). Without them
  there is no DSN and step 6 cannot be done — that is an account-provisioning dependency, not
  engineering time.
- Needs installs; the `pnpm add` policy applies.

---

# Task T25-Android — EAS development-client build

**Implements:** specs §I "T25-Android specification" · §12 T25, §P8 · **Owner:** Arlo
**Ideal days:** 1.5 · **Gated on:** **Decision D-I** (does each dev have an Android handset?)
**Depends on:** A1/A2, an Expo account, a Firebase project. **Blocks:** T26-FCM, gate #3's Android
half, gate #4's dogfood window.

Push no longer works in Expo Go on Android (SDK 53+), so a dev build is mandatory — and it is the same
mechanism TestFlight distribution needs, so it is not throwaway work. **T25-iOS, T26-APNs, TestFlight
and Apple Sign-In are out of scope**: they are blocked on the Apple Developer enrolment (T3) with its
~2-week verification tail.

**Files**

- Create `apps/mobile/eas.json` — a `development` profile with `developmentClient: true`,
  `distribution: 'internal'`, `android.buildType: 'apk'`.
- Modify `apps/mobile/app.json` — `android.googleServicesFile` pointing at `./google-services.json`;
  `android.package` is already `com.planpal.app`.
- Modify `apps/mobile/package.json` — `expo-dev-client` and `expo-notifications` via `expo install`.
- Modify `.gitignore` — `apps/mobile/google-services.json`. **It is supplied through an EAS file
  secret and is never committed.**
- Modify `docs/SECRETS.md` — inventory rows for `EXPO_ACCESS_TOKEN`, the `google-services.json` EAS
  file secret, and the FCM V1 service-account JSON, each with a rotation owner.

**Steps**

1. Answer D-I first, in writing. **If either dev is iPhone-only, that dev's half of gates #3 and #4
   is Apple-blocked**, and this plan must say so now rather than discover it at freeze. Record the
   answer in `MONTH_3_4_PLAN.md`.
2. There is no unit test for a build profile. The equivalent of the red run is the current state,
   recorded: `ls apps/mobile/eas.json` → does not exist; and the fact that no APK exists anywhere.
3. Create the Firebase project with an Android app of id `com.planpal.app`, download
   `google-services.json`, and upload it as an EAS file secret. Upload the FCM V1 service-account
   JSON under EAS credentials.
4. Build: `pnpm --dir apps/mobile exec eas build --profile development --platform android`. Record
   the build URL.
5. Install the APK on each dev's handset from the EAS build URL, sign in, and confirm:
   - the app launches with **no red-box** — this closes A1's outstanding DoD bullet, the one the
     bundle gate cannot see (a React 19.2 renderer against an RN 0.79 reconciler);
   - a push token is registered on launch, visible as a `devices` row:
     `psql -c "select platform, expo_push_token, last_seen_at from public.devices"`.
6. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm build` (the export gate must
   survive the two new native modules), `pnpm test`.

**Definition of done**

- Both devs have the dev-client APK installed from an EAS build URL and are signed in.
- `devices` has one row per phone, with a real Expo push token (not the fake one D2 uses).
- The app launches with no red-box on a real handset — pasted or screenshotted.
- `google-services.json` is **not** in the repo: `git ls-files | grep google-services` returns
  nothing.
- `docs/SECRETS.md` carries the three new inventory rows.
- If D-I is answered "not both devs", the Apple block on gates #3 and #4 is written into
  `MONTH_3_4_PLAN.md` with the date it was known.

**Rollback**

Revert the commit; `eas.json` and the `app.json` change are additive and an unused build profile is
inert. The Firebase project and EAS secrets are external state — leave them; they cost nothing and
T26 needs them.

**Risks that make it slip**

- **EAS build queue times** are outside our control and can be hours on a free tier. Start the first
  build early in the day, not at the end of one.
- **Firebase console access** is an account dependency, like the Supabase projects.
- Two new native modules (`expo-dev-client`, `expo-notifications`) change the native build. If the
  build fails, suspect these before suspecting app code, and check them against the SDK 53 pins with
  `expo install --check` (the A2 gate).
- D-I is a hardware question with no engineering workaround. Answer it early.

---

# Task T26-FCM — FCM credentials and a real push (Android half)

**Implements:** §12 T26, §P8 · specs §I · **Owner:** both · **Ideal days:** 0.5
**Gated on:** D-I · **Depends on:** T25-Android, D3 (cron live), T11 (done). **This is MVP gate #3's
Android half** — and the only thing that proves delivery, as opposed to dispatch.

**Files**

- No source files. Modify `docs/SECRETS.md` if the FCM service-account row was not added in T25.
- Record the evidence against gate #3 in whatever the team uses for the gate evidence log (I1
  creates it if it does not exist).

**Steps**

1. There is no test to write: the deliverable is a notification arriving on physical hardware, which
   no runner can assert. The equivalent of a written-down expectation is: a reminder for a
   **recurring** event, on a backgrounded app, at the configured lead time, suppressed inside quiet
   hours.
2. Confirm the FCM V1 service-account JSON is uploaded under EAS credentials (T25 step 3) and that
   `expo push:android:show` (or the EAS credentials view) reports it present.
3. Create a **recurring** event whose next occurrence is inside the lead window. Background the app.
   Wait for a tick.
4. Record the delivery, and check the three layers from D3 alongside it so a non-delivery is
   diagnosable rather than mysterious: `cron.job_run_details` `succeeded`,
   `net._http_response` `200`, and a new `notification_sends` row for that `event_id` and
   `occurrence_date`.
5. Verify quiet hours suppress correctly **across an overnight window** — set quiet hours spanning
   midnight, confirm no notification, then confirm one arrives after the window ends. An overnight
   window is where the off-by-one lives.
6. Verify dead-token pruning: deregister the device (`DELETE /me/devices/{token}`) or use a stale
   token, confirm the `devices` row is removed rather than retried forever.

**Definition of done**

- A reminder for a **recurring** event arrives on a physical Android handset with the app
  backgrounded — screenshot with a timestamp. Gate #3's Android half, evidenced.
- The same series notifies on **more than one** occurrence. The M2 defect this replaces was
  "recurring events notified exactly once", so one arrival proves nothing.
- Quiet hours suppress across an overnight window, then release.
- A deregistered token is pruned from `devices`.
- Gate #3's iOS half is explicitly recorded as Apple-blocked, with the T3 enrolment date.

**Rollback**

Nothing to roll back. If pushes misbehave, `select cron.unschedule('notify-scheduler')` is the
emergency stop from D3 and needs no deploy.

**Risks that make it slip**

- **Push delivery varies wildly** by device, OS and power-saving mode. Budget real time for Android
  Doze and for a force-quit app; simulators prove nothing here.
- A tick every minute means a wait of up to a minute per attempt. Do not shorten the schedule to
  iterate faster and forget to put it back.
- If D3's step-6 fallback was taken (`verify_jwt = false`), re-confirm the function is still
  reachable after the deploy that T25 may have triggered.

---

# Task T28 — Event management on web (Month 4, §P9)

**Implements:** §12 T28, §P9 · specs §I · **Owner:** Arlo · **Ideal days:** 3
**Gated on:** the descope decision (this is third on the list) · **Depends on:** T20, B3.
**Must merge before freeze**, or be descoped in writing.
**Blocks:** H4 (Playwright stage 2).

Web reaches full parity and becomes the primary dev/test environment as intended. This and T29 are
the two items deliberately moved out of Month 3 — **nothing else is added to weeks 13–14.**
Spillover creep here eats the stabilisation window that protects the gate.

**Files**

- Create `apps/web/src/components/event/EventForm.tsx` — create and edit a master.
- Create `apps/web/src/components/event/OccurrenceSheet.tsx` — override and cancel one occurrence.
- Create `apps/web/src/app/calendar/event/[id]/page.tsx` — the edit route.
- Modify `apps/web/src/app/calendar/page.tsx` — wire create/edit/delete entry points.
- Modify `packages/recurrence/src/rrule.ts` (or add `buildRRule` beside the parser) — **`buildRRule`
  currently lives in `apps/mobile`'s event form.** RRULE construction belongs beside the parser; when
  web grows an event form this is exactly the fork AD-3 exists to prevent. Move it, with tests, and
  re-run `pnpm recurrence:sync`.
- Modify `apps/mobile/src/components/event/CreateEventForm.tsx` — import the moved `buildRRule`
  rather than keeping a copy.

**Steps**

1. Write the failing tests, in this order — the package first, because the move is the risky part:
   - `packages/recurrence/src/rrule.test.ts` gains
     `it('builds a weekly BYDAY rule from a form selection')` and
     `it('round-trips every rule it builds through the parser')`. The round-trip is the assertion
     that makes the move safe.
   - `apps/web/src/components/event/EventForm.test.tsx`,
     `it('submits a recurring master with the rule the selection implies')`.
   - `apps/web/src/components/event/OccurrenceSheet.test.tsx`,
     `it('sends a PATCH override for one date, not an update to the master')` — the distinction PR
     #3's defect 1 got wrong in the other direction.
2. Run and record the red runs: `pnpm --filter @planpal/recurrence test` and
   `pnpm --dir apps/web test`. Paste both.
3. Move `buildRRule` into the package, then build the web forms.
4. Re-run both and record passing. `@planpal/recurrence` must still meet its enforced bar —
   lines ≥ 90, branches ≥ 85, functions ≥ 90 — and moving code in raises the denominator, so check
   the numbers rather than assuming.
5. Run the surrounding gates: `pnpm recurrence:sync` then `pnpm recurrence:check` (the Deno mirror
   must be regenerated and in sync), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`,
   `pnpm test:integration`.
6. Verify by hand on web against dev: create a recurring event, edit the master, override one
   occurrence, cancel one occurrence, delete the master. Then confirm the **mobile** app shows the
   same state — parity means both clients agree, and this is the cheapest moment to catch a
   divergence.

**Definition of done**

- Create, edit, delete, occurrence override and cancel all work on web against dev, with mobile
  showing the same result.
- `grep -rn "buildRRule" apps/mobile apps/web` shows both importing from `@planpal/recurrence`, with
  no local copy.
- `pnpm recurrence:check` green — the Deno mirror was re-synced.
- `@planpal/recurrence` still meets its coverage bar; paste the numbers.
- The three named `it(...)` titles pass.

**Rollback**

Revert the commit and run `pnpm recurrence:sync` to restore the mirror bytes, then
`pnpm recurrence:check` to confirm. `buildRRule` returns to `apps/mobile` and the fork returns with
it — which is why, if T28 is descoped, the `buildRRule` move should still land on its own. Split it
into its own commit so that is possible.

**Risks that make it slip**

- The `buildRRule` move touches the recurrence engine, which is the project's #1 risk area and the
  one place with an enforced 90 % bar. Land it as its own commit with its own green run before any
  web form work.
- Three ideal days in the freeze week with T29 alongside is 5.5 days of work in five. **This is the
  arithmetic behind the capacity note**; decide early, not at freeze.
- Full offline **editing** stays Post-V1. Do not let "edit on web" grow into "edit offline".

---

# Task T29 — Offline read-only (Month 4, §P9)

**Implements:** §12 T29, §P9 · AD-10 · **Owner:** Arlo · **Ideal days:** 2.5
**Gated on:** the descope decision (second on the list, after T24 and H2) · **Depends on:** B4's
cache seam (policy + `fetchedAt`) and T18.

The app opens and shows the last-known calendar with no network, with a clear offline indicator, and
edits blocked with an explanatory state rather than a failure. **This becomes a rewrite rather than
a feature if B4 landed without a read policy and freshness metadata** — which is why B4 specifies
both.

**Files**

- Create `packages/api-client/src/adapters/asyncStorage.ts` — the `CacheAdapter` implementation over
  `AsyncStorage`. AD-9 bans **tokens** from `AsyncStorage`, not calendar data, so this is legal —
  say so in a comment, because it looks like a violation at a glance.
- Create `packages/api-client/src/adapters/asyncStorage.test.ts`.
- Modify `apps/mobile/src/lib/planpalClient.ts` — use the AsyncStorage adapter and
  `policy: 'cache-first'` on the calendar read.
- Create `apps/mobile/src/components/OfflineBanner.tsx` — renders the `fetchedAt` from the cached
  month as "last updated …".
- Modify `apps/mobile/src/lib/emptyStates.tsx` (from T18) — the edits-blocked state.
- Modify `apps/mobile/package.json` — `@react-native-async-storage/async-storage` via
  `expo install`.

**Steps**

1. Write the failing tests:
   - `packages/api-client/src/adapters/asyncStorage.test.ts`,
     `it('round-trips a cached month envelope through a fake AsyncStorage')` and
     `it('clears only the occ: prefix, leaving other keys intact')`.
   - `apps/mobile/src/components/OfflineBanner.test.tsx` (needs H2),
     `it('renders the cached fetchedAt as a last-updated time')`.
   - `apps/mobile/src/lib/offlineWrite.test.ts`,
     `it('blocks a write with an explanatory state instead of throwing a network error')`.
2. Run and record the red runs. Paste them.
3. Implement.
4. Re-run and record passing; `@planpal/api-client` must still meet its ≥ 70 bar.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
6. Verify by hand, and this is the only convincing test: load the calendar on a handset, enable
   airplane mode, force-quit the app, reopen it. The calendar must render from cache with the offline
   banner and a plausible "last updated" time, and attempting an edit must explain itself rather than
   fail.

**Definition of done**

- The app opens with no network and shows the last-loaded calendar, with the offline indicator and a
  `fetchedAt`-derived "last updated" — demonstrated in airplane mode after a force-quit, screenshot
  attached.
- An attempted edit while offline shows the explanatory state; no unhandled rejection appears in the
  logs.
- `grep -rn "AsyncStorage" packages/api-client/src` shows it used only in
  `adapters/asyncStorage.ts`, and **never** for a token.
- Coverage bars still met for `@planpal/api-client`.

**Rollback**

Revert the commit and `pnpm install`. The client falls back to B4's in-memory adapter, which means
no offline read — the pre-T29 behaviour, and a working state.

**Risks that make it slip**

- `AsyncStorage` has a per-key size limit on some Android versions. A year of occurrences in one
  month-keyed entry is small, but a variable-schedule user with many exceptions is the case to try.
- Detecting "offline" reliably on a handset is harder than it looks; prefer treating a failed request
  as offline (the client already throws a typed error) over polling a connectivity API.
- If descoped, say so in writing at freeze and record that the app requires a network — do not leave
  a half-wired cache adapter in the tree.

---

# Task H4 — Playwright stage 2, the full §P7 journey (Month 4)

**Implements:** specs §H, stage 2 · §P7 · **Owner:** Arlo · **Ideal days:** 0.5
**Gated on:** nothing · **Depends on:** T28 and H3. **Month 4 only** — this is the task that makes
§P7's journey real rather than aspirational.

**Files**

- Create `apps/web/e2e/journey.spec.ts` — the full journey through the UI.
- Modify `docs/TESTING.md` — mark stage 2 done with its date, closing the two-stage note H3 added.

**Steps**

1. Write the failing test. `apps/web/e2e/journey.spec.ts`,
   `it('signs up, creates a recurring event, overrides one occurrence and sees it')` — every step
   through the real UI, no API seeding. That is the only difference from stage 1, and it is the whole
   point.
2. Run and record the red run: `pnpm --dir apps/web e2e journey`. Paste it — before T28's forms exist
   it fails at the create step, which is the evidence that stage 1 was the honest scope in Month 3.
3. Implement (mostly selectors and waits; the behaviour is T28's).
4. Re-run and record passing.
5. Run the surrounding gates: `pnpm lint`, `pnpm typecheck`, the `e2e` job in CI.

**Definition of done**

- The journey passes in CI against the local stack, driven entirely through the UI.
- `docs/TESTING.md` records stage 2 complete with the date, and §P7's journey is no longer described
  as split.

**Rollback**

Revert the commit. Stage 1 remains as the CI journey, which is a working state.

**Risks that make it slip**

- Sign-up through the UI depends on H3's Mailpit link extraction. If that was left as an optional
  spec, this task inherits the problem.
- UI-driven E2E is the most brittle test in the repo. Assert on user-visible text (the moved time,
  the absent date), never on class names or DOM structure.

---

# Task I1 — Month 4 readiness review and the gate evidence log

**Implements:** specs §I · §P12, the MVP exit gate · **Owner:** both · **Ideal days:** 0.5
**Gated on:** nothing. **Do it early enough to act on what it finds**, not as a closing formality.

This is the task that stops the plan's assumptions from being discovered rather than decided.

**Files**

- Modify `MONTH_3_4_PLAN.md` — record the D-I answer and any Apple block on gates #3 and #4, and the
  descope decision if one is taken. **The D-0 week anchor no longer exists** — the week schedule was
  removed on 2026-09-08 (see § No week schedule), so there is nothing to record for it.
- Create `docs/GATE_EVIDENCE.md` — one section per MVP gate criterion (1–7), each with the evidence
  required and a slot for the evidence itself. The gate's own wording is "evidence required … not a
  self-assessment", so the log exists to hold artefacts, not ticks.
- No edit to this file is needed for scheduling — it no longer carries one.

**Steps**

1. Answer D-I and record it. If either dev is iPhone-only, write the Apple block on gates #3 and #4
   into `MONTH_3_4_PLAN.md` with today's date.
2. Take the descope decision explicitly against the capacity arithmetic at the top of this document:
   Arlo's 24 ideal days against ~18.75 effective. Recommended order if something must give — T24,
   then H2, then T29, then T28. **Never** P7's tests and never T30.
3. Create `docs/GATE_EVIDENCE.md` with the seven criteria and the evidence each needs:
   1. Event CRUD stable — integration tests green plus an empty critical/high CRUD queue.
   2. Recurrence edge cases — engine suite green at ≥ 90 % **and** the §P11 manual
      DST/leap/rollover checklist signed.
   3. Push on real devices — a **recurring**-event reminder received on physical iOS **and** Android,
      app backgrounded (T26-FCM covers the Android half; iOS is Apple-blocked).
   4. Both devs used it daily ≥ 2 weeks — the 14-day dogfood log.
   5. Ten real users tested — session notes per user.
   6. All critical + high fixed — empty queue, mediums on a written known-issues list.
   7. Backups restorable — T30's completed, dated test restore.
4. Walk the two milestone conditions from the top of this document item by item and record, for
   each, whether it is on track. Write down what is not.
5. Confirm the two known limits of this gate in writing, so the Beta privacy QA pass does not assume
   they were covered: **cross-user visibility leakage cannot be tested before M6** (no friend graph),
   and **iOS push and TestFlight are Apple-blocked** pending T3.

**Definition of done**

- `docs/GATE_EVIDENCE.md` exists with all seven criteria and their required evidence.
- The descope decision is recorded with a date and a rationale.
- Every milestone condition has a written on-track / not-on-track judgement.
- The two known gate limits are recorded.
- Tester recruiting is under way — it is **lead time, not engineering time** (§Risks), so it has to
  start well before the dogfood window, especially for people with variable-schedule jobs.

**Rollback**

Revert the documentation commit. Decisions recorded in a PR thread survive it, which is the point of
recording them there as well as in the file.

**Risks that make it slip**

- This task's only real risk is not doing it, and then discovering at freeze that the dogfood window
  is arithmetically unreachable. Fourteen consecutive days of dogfooding has to fit between the
  installable build and the gate.
- `T31` (bug bash, device matrix, tester onboarding, 8 shared days) is out of this plan's scope but
  starts at freeze and depends on T25–T29. If the descope moves T28/T29, T31's start does not move —
  the freeze does not wait.

---

# Dependency graph

Arrows mean "must land before". Tasks on the same line are independent of each other.

```
ARLO — the critical path
  A1 (fix) ─► A2 (gate)          [one PR, two commits; A2's gate demonstrated red against A1's parent]
       │
       ├─► T24 ────────────────────────────────────┐
       └─► T25-Android ◄── D-I ────────────────────┤
                │                                  │
  B1 ─► B2 ─► B3 ─► B4                             │
   │     │     │     └─► T29 ◄── T18               │
   │     │     └─► B6 (real 401)                   │
   │     └─► T7 ─► T18 ─► T25-Android ─► T26-FCM ◄─┘
   └─► B5 (lint)                                   │
                                                   │
  B3 ─► T20 ─► T28 ─► H4                           │
  H1 ─► T20's tests                                │
  H1 + T7 + T20 ─► H3 (Playwright stage 1)         │
  H2 ◄── D-H                                       │
                                                   ▼
                                   dogfood (14 consecutive days) ─► MVP gate

SCOTT — fully parallel, nothing on Arlo's line waits on any of it
  E0 ◄── E1, E5                    (unblocks merging PR #3)
  E-W1 ◄── E2, E3
  E4 ◄── decision E4               (unblocks marking T13 done)
  G1 ─────────────────► G2  ◄── C2         (G2 after C2, so the serializer edit is free)
  C0 ◄── CLI-pin ─► C1 ─► C2 ─► F2b
  F1                               (independent)
  F2a                              (independent — no prerequisites at all)
  D1 ─► D2 ─► D3 ◄── C2            (D after C, so the handler's column list is already literal)
  T30                              (independent — start early)

BOTH
  I1 ◄── D-I, descope
```

**Encoded sequencing rules**, restated so they cannot be missed:

- **A2 never lands before A1.** One PR, two commits, and commit 2's gate demonstrated red against
  commit 1's parent. A gate that has never failed is unproven.
- **C before D and G2**, so their serializer edits inherit the generated row types instead of
  hand-written interfaces that C2 would then rewrite.
- **F2a can land on its own, first.** It depends on nothing and closes the wire half of the drift gap that
  G2's `isBirthday` would otherwise walk straight through.
- **H1 needs nothing; H3 needs T7 and T20; H4 needs T28.** Stage 1 seeds through the API because web
  has no event form until T28.
- **Every new `SECURITY DEFINER` function ships with its revokes in the same migration** (§15) —
  G1's `protect_is_birthday` and F1's `rotate_friend_code` both restate their grants in-file.
- **Every new endpoint ships with an integration test in the same PR** (§15) — E-W1, D2, G2.
- **Every new shared package sets coverage thresholds at creation** (§15) — B1 sets ≥ 70 in
  `packages/api-client/vitest.config.ts` before any resource module exists.
- **A contract change is two-dev and commits the regenerated types** (§15) — E-W1, G2, F2b.

---

# Critical path, in order and ideal days

**No dates.** The sequence and the durations are what the plan commits to; where the sequence starts
is whatever you decide. Cumulative days are along Arlo's line, which is the critical one.

| Order | Task                                  | Ideal days | Cumulative | Notes                                  |
| ----- | ------------------------------------- | ---------- | ---------- | -------------------------------------- |
| 1     | A1 + A2                               | 1          | 1          | one PR, two commits                    |
| 2     | B1–B6                                 | 3          | 4          |                                        |
| 3     | T7                                    | 3          | 7          |                                        |
| 4     | T18                                   | 2          | 9          |                                        |
| 5     | T25-Android                           | 1.5        | 10.5       |                                        |
| —     | **Installable builds on both phones** | —          | **10.5**   | the first milestone                    |
| 6     | T20                                   | 4          | 14.5       |                                        |
| 7     | H1 + H3                               | 2          | 16.5       |                                        |
| 8     | T28                                   | 3          | 19.5       |                                        |
| 9     | T29                                   | 2.5        | 22         |                                        |
| 10    | T24 + H2                              | 2          | 24         | first two on the descope list          |
| —     | **Feature freeze**                    | —          | **24**     | T28/T29 merged or descoped in writing  |
| —     | Dogfood window                        | 14 days    | —          | 14 **consecutive** days, calendar time |
| —     | **MVP gate**                          | —          | —          | after the dogfood window closes        |

Scott's line runs fully parallel and is comfortable at roughly 7.5 ideal days: E0 and F2a first (both
independent), then E-W1, G1, C0, C1, T30; then C2, G2, F1, F2b, D1, D2; then D3; T26-FCM alongside
Arlo's T25-Android; E4 whenever two calendar accounts are to hand.

**The overrun is on Arlo's line and it is arithmetic, not scheduling.** Ten and a half ideal days
reach an installable build. Everything after it — T20 (4) + H1/H3 (2) + T28 (3) + T29 (2.5) + T24 (1)

- H2 (1) — is 13.5 more. Against a five-week run of 25 working days, about 18.75 survive the plan's
  own 20–30 % non-feature reserve, so 24 ideal days does not fit. **If it must give, descope in this
  order: T24, H2, T29, T28.**

The one boundary that cannot absorb a slip is the freeze: the dogfood window needs 14 _consecutive_
calendar days and it cannot start until there are builds to dogfood.

---

# Decisions → gated tasks

| Decision    | Recommended answer                                               | Tasks that cannot start until it is answered  | Status (2026-09-08)           |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------- | ----------------------------- |
| **E1**      | Keep `PATCH` → `EventOccurrence`; sign off on PR #3 item 1       | E0 — and PR #3 does not merge without it      | Answered                      |
| **E2**      | Declare the 503 with the `ApiError` envelope                     | E-W1                                          | Answered                      |
| **E3**      | Add `Health.version`, injected from `$GITHUB_SHA`                | E-W1                                          | Answered                      |
| **E4**      | Do the import now, twice (Google + Outlook.com)                  | E4 — and T13 cannot be marked done without it | Answered; **imports pending** |
| **E5**      | Accept the `delete_me()` grant; amend §15                        | E0 — and PR #3 does not merge without it      | Answered                      |
| **CLI-pin** | Pin `supabase` CLI to **2.117.0**                                | C0, and therefore C2 and F2b                  | Answered                      |
| **D-H**     | `jest-expo` for `apps/mobile`, as the one documented exception   | H2                                            | Answered; H2 done             |
| **D-I**     | Does each dev have a physical Android phone?                     | T25-Android, T26-FCM                          | **OPEN**                      |
| **Descope** | T24 → H2 → T29 → T28, in that order; never P7's tests, never T30 | T24, H2, T29, T28                             | Moot — all four built         |

**D-0 (the week anchor) has been deleted**, along with the week schedule it anchored (2026-09-08).

---

# Hypotheses and the step that verifies each

The specs plan labels these as things it could not run. **Nothing may depend on one of these until
its verifying step has been executed and its output pasted.**

| #   | Hypothesis                                                                                  | Verified by                                                                                     | Status                                                                                           |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `expo export` succeeds once the SDK 53 pins are applied (the probe was refused by policy)   | **A1 step 5** — the export must exit 0 and write a bundle                                       | open — the strongest evidence today is at the codegen-parser layer only                          |
| 2   | `expo install --check` exits non-zero on a mismatch (the specs plan only saw piped text)    | **A2 step 2** — records the exit code                                                           | **resolved 2026-09-08: exits 1**, same seven packages. No `grep` fallback needed                 |
| 3   | Generated types survive supabase-js minor upgrades (PostgREST composite-return typing)      | **C2 step 4** + pinning `esm.sh/@supabase/supabase-js@2.x.y` in the same PR                     | open                                                                                             |
| 4   | The **cloud** gateway accepts `apikey` alone, as the local one does                         | **D3 step 6** — `net._http_response.status_code = 200` on the first scheduled tick              | open — fallback to `verify_jwt = false` the same day                                             |
| 5   | `pg_net` is enabled and vault secrets exist on `planpal-dev`                                | **D3 step 5** — the operator's `vault.create_secret` run and the layer-1/2 checks               | open — no SQL access to the cloud project in the investigating session                           |
| 6   | The local edge runtime picks up `CRON_SECRET` from `supabase/functions/.env`                | **D2 step 4** — observe the 500 turn into a 403 for a wrong secret                              | open — this is the observation, not an inference                                                 |
| 7   | The `.ics` imports correctly into a real calendar (RFC 5545 tests do not cover `VTIMEZONE`) | **E4 steps 2–3** — Google **and** Outlook.com, against the written-down expected set            | open — Google alone proves least                                                                 |
| 8   | React Native's `fetch` behaves like the web's for our uses (Blob support is partial)        | **B3's `export.ical` returns `string`**, proven end-to-end in **B6** and on a device in **T18** | open                                                                                             |
| 9   | The iOS Keychain 2048-byte limit breaks a supabase-js session JSON                          | **B2 step 1** — the chunking test with a ≥ 3 KB fixture                                         | open — will not surface in Android-only dogfooding                                               |
| 10  | Mailpit's `GET /api/v1/messages` shape supports link extraction                             | **H3 step 4** — fallback is GoTrue `email_confirm: true`                                        | open                                                                                             |
| 11  | React Native renders `'__birthday__'` as transparent with a warning rather than crashing    | **T18 step 1** — the extracted `eventColor` helper's test, plus the device check                | open — G2 removes the sentinel from the wire regardless                                          |
| 12  | The 14 hand-typed route paths in `packages/api-client` are correct                          | **B6** against the real stack; until then B3's claims hold only against a stub                  | open                                                                                             |
| 13  | The Supabase plan tier in use provides automated backups                                    | **T30 step 1** — state the tier; free tier has none                                             | open — if free, that is a finding for I1                                                         |
| 14  | There are 23 `as unknown as` casts to remove                                                | **C2 step 1** — grep and paste the count                                                        | **resolved 2026-09-08: 22 code hits plus one explanatory comment** at `occurrences/index.ts:106` |

## Corrections this plan carries forward from the specs plan

Recorded so a reader of the older documents is not misled:

1. **§P7's Playwright journey needs T28 (Month 4).** Split into two stages — H3 and H4.
2. **§5's lint rule cannot ban `fetch` with `no-restricted-imports`** — `fetch` is a global;
   `no-restricted-globals` is the rule (B5).
3. **AD-11 overstates what generated types fix** — they fix nothing while column lists are built by
   concatenation (C1 before C2).
4. **§9 / `20260614000002`'s cron snippet is wrong twice** — GUCs instead of the vault, service-role
   bearer instead of the anon key (D3).
5. **T13's "RFC 5545 verified" omits `VTIMEZONE`**, which the RFC requires per referenced TZID (E4).
6. **§14 #4's "SDK 53 floor, no plan change"** reasoned about the SDK while `^` ranges permitted
   post-SDK native modules — that is the bundle failure (A1).
7. **The 401 the client sees is not the contract's** — expired or malformed JWTs get the gateway's
   body, not the `ApiResult` envelope (B1).
8. **The birthday sentinel is user-writable** and produces orphaned masters (G1).
9. **`docs/BOOTSTRAP.md` says Node 20**; `package.json` `engines` and CI say 22 — fixed in C0.
10. **The `supabase` CLI is unpinned** — fixed in C0.
11. **`CLAUDE.local.md`'s "deploy-staging is inert" note is now stale.** Commit `a837319` made the
    workflow deploy the API and prove it answers (T4); it guards on one `configured` gate rather than
    `exit 0`-ing each step. E-W1 extends its smoke check rather than fixing it.
12. **`CLAUDE.local.md`'s "no `vitest.config.ts` sets coverage thresholds" note is also stale** —
    `packages/calendar-core/vitest.config.ts` sets 90 across all four metrics. B1 follows that
    precedent at 70.
