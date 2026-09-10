# PlanPal — Month 3/4 specs plan (investigation of 2026-09-07)

**Branch:** `month3-development`, 25 commits ahead of `main`, PR #3 open and mergeable, four CI checks green.
**Purpose:** make the remaining Month 3 and Month 4 work executable by someone who was not in the room. Every claim below is labelled as **verified** (I ran it and quote the output) or **hypothesis** (I could not run it, and say why).
**Companions:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) (§ references), [MONTH_3_4_PLAN.md](MONTH_3_4_PLAN.md) (P references), PR #3's body (defect and decision numbering).

## How this was verified

Everything ran against the local stack (`pnpm db:start`, Postgres 17, `FUNCTIONS_URL` present) and the checked-out tree, with the cloud project consulted read-only.

| Check                                           | Result                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm test:integration`                         | 10 files, **195 passed**, 23.7 s                                                                     |
| `expo export --platform android` (mobile)       | fails at 970 modules, `ModalScreenNativeComponent.ts: Unknown prop type for "onAppear": "undefined"` |
| `expo install --check` (mobile)                 | 7 packages off the SDK 53 pins (listed in A)                                                         |
| `supabase gen types typescript --local`         | 1123 lines; consumed by `deno check` with no mirror step (C)                                         |
| `supabase functions list` (cloud `planpal-dev`) | 7 functions, all `verify_jwt: true`                                                                  |
| Local `pg_net` post to `notify-scheduler`       | `401 UNAUTHORIZED_NO_AUTH_HEADER` from the gateway (D)                                               |
| Live birthday probe                             | `colorLabel: "__birthday__"` on the wire, and a new orphaning defect (G)                             |
| `planpal-sample.ics` through ical.js            | parses and expands correctly, but the file has no `VTIMEZONE` (E4)                                   |

Probes were throwaway and are gone: `apps/mobile/dist-probe` deleted, the probe-only `pg_net` extension dropped, working tree `git status` clean. One probe was refused by the session's tool policy (installing a pinned `react-native-screens` into the workspace), so the end-to-end proof of the A fix is at the codegen-parser layer, not a green `expo export`. That is stated where it matters.

## Calendar anchor (an assumption the plan does not state)

> **SUPERSEDED, 2026-09-08.** The week schedule this section proposes was removed from
> `M3_M4_IMPLEMENTATION_PLAN.md`, and decision **D-0 was deleted rather than answered**: the anchor
> could not be settled, the two readings differed by four weeks, and one of them put the build
> deadline in the past. The plan is now ordered by dependency and estimated in ideal days, with no
> start dates and no deadlines.
>
> **Every date below is historical.** It records what the 2026-09-07 investigation assumed, not a
> schedule anyone should work to. Do not resurrect it — the ordering constraints that actually bind
> are in the implementation plan's § Critical path.

No document ties "wk 9" to a date. The plan was revised 2026-09-01 and every finished T-task landed 2026-09-02/03, so I take **wk 9 = week of Mon 2026-08-31**. Then:

| Milestone                         | Week      | Date           |
| --------------------------------- | --------- | -------------- |
| Today                             | wk 10     | Mon 2026-09-07 |
| Installable builds on both phones | end wk 13 | Sun 2026-10-04 |
| Feature freeze                    | end wk 14 | Sun 2026-10-11 |
| Latest dogfood start for 14 days  | wk 15     | Mon 2026-10-12 |
| MVP gate                          | end wk 16 | Sun 2026-10-25 |

If wk 9 is instead counted from the repo's first commit (2026-06-08), today is already the freeze week and the build deadline has passed. **Decision D-0: confirm the anchor in `MONTH_3_4_PLAN.md`.** Everything in §I depends on it.

## Start order

Items are presented in the order they should be started, not alphabetically.

| #   | Item                                        | Owner | Type              | Start                        | Ideal days | Unblocks                                   |
| --- | ------------------------------------------- | ----- | ----------------- | ---------------------------- | ---------- | ------------------------------------------ |
| 1   | A — mobile bundle + CI gate                 | A     | work              | now                          | 1          | T18, T23-mobile, T24, T25-Android, dogfood |
| 2   | E — five PR #3 decisions                    | both  | decision          | now (30 min)                 | 0.5        | merging PR #3                              |
| 3   | B — `packages/api-client` (T8)              | A     | work              | now, parallel to A           | 3          | T18, T19, T20, T29                         |
| 4   | G — `birthday_flag` migration               | S     | work              | now                          | 1          | T19 colour picker                          |
| 5   | C — generated DB types (T32)                | S     | work              | now                          | 1          | removes 23 casts; F2 row half              |
| 6   | F — advisory lock; contract-shape from YAML | S     | work              | with C                       | 1          | —                                          |
| 7   | D — `pg_cron` live (T27)                    | S     | work              | after C lands (shares files) | 1.5        | gate #3, T26                               |
| 8   | H — app test runners + Playwright (T23)     | A     | work + 1 decision | after A                      | 3          | CI coverage of apps                        |
| 9   | I — Month 4 readiness                       | both  | plan              | wk 12                        | —          | gate #4                                    |

Scott's items (4–7) all parallelise with Arlo's chain (1 → 3 → T7/T18). Arlo's chain is the critical path.

---

## A. `apps/mobile` cannot bundle — P0

**ID / owner / ref:** A · Arlo · §P3, T18, T23; PR #3 "Not addressed"

### Problem

Metro cannot produce a JS bundle for the mobile app, so nothing downstream of it (real data, device registration, EAS builds, dogfooding) can start, and nothing in CI notices because `apps/mobile` has no `build` or `test` script and `tsc` under `moduleResolution: "Bundler"` does not exercise Metro's transform.

### Evidence (verified)

Repro on the current tree:

```
CI=1 pnpm --dir apps/mobile exec expo export --platform android --output-dir dist-probe
Android Bundling failed 12952ms node_modules\expo-router\entry.js (970 modules)
SyntaxError: ..\..\node_modules\react-native-screens\src\fabric\ModalScreenNativeComponent.ts:
  Unknown prop type for "onAppear": "undefined"
```

PR #3 saw `SearchBarNativeComponent.ts` / `onSearchFocus`. Same failure class, different file first: Metro transforms in parallel workers, so whichever `react-native-screens` spec file a worker reaches first reports. Both files use the same construct.

Resolved versions from `apps/mobile`:

```
react-native-screens 4.25.2   react-native 0.79.7   expo 53.0.27   expo-router 5.1.11
@react-native/codegen 0.79.7  @react-native/babel-plugin-codegen 0.79.6
babel-preset-expo 13.2.5      metro 0.82.5          react 19.2.7
```

`expo install --check`:

```
react@19.2.7 - expected version: 19.0.0
react-dom@19.2.7 - expected version: 19.0.0
react-native@0.79.7 - expected version: 0.79.6
react-native-safe-area-context@5.8.0 - expected version: 5.4.0
react-native-screens@4.25.2 - expected version: ~4.11.1
@types/react@19.2.17 - expected version: ~19.0.10
typescript@5.9.3 - expected version: ~5.8.3
```

Root cause, traced to the line:

- `react-native-screens@4.25.2/package.json` declares `peerDependencies.react-native: ">=0.82.0"`. 4.11.1, 4.12.0, 4.13.x, 4.14.0, 4.16.0 and 4.20.0 all declare `"*"`. The floor moved after 4.20.0.
- The 4.25.2 spec files do `import type { CodegenTypes as CT } from 'react-native'` and type events as `CT.DirectEventHandler<…>`. `react-native@0.79.7` has no `CodegenTypes` export (`grep CodegenTypes node_modules/react-native/index.js types/index.d.ts` → nothing). The 4.11.1 file imports `DirectEventHandler` from `react-native/Libraries/Types/CodegenTypes`, which the 0.79 parser matches by name.
- `@react-native/codegen/lib/parsers/typescript/components/componentsUtils.js:410` throws `Unknown prop type for "${name}": "${type}"` when `parser.getTypeAnnotationName()` returns `undefined` for the qualified `CT.DirectEventHandler` reference. That is the exact message.
- Direct proof, bypassing Metro: running RN 0.79.7's `TypeScriptParser.parseFile` on the same file at both versions:

```
codegen version 0.79.7
FAIL  react-native-screens 4.25.2 (installed): Unknown prop type for "onAppear": "undefined"
OK    react-native-screens 4.11.1 (Expo SDK 53 pin): 31 props, 11 events
```

Ruled out: babel (`babel.config.js` is stock `babel-preset-expo`), Metro config (stock plus `watchFolders`/`nodeModulesPaths` for the monorepo), pnpm hoisting (`node-linker=hoisted`, exactly one copy of `react-native-screens`; hoisting is what Expo requires). `react-native-safe-area-context@5.8.0`'s specs still use the `react-native/Libraries/Types/CodegenTypes` import, so it is off-pin but not the crash.

Reproducible on a clean install: yes. `pnpm-lock.yaml` pins `react-native-screens@4.25.2` on both this branch and `main` (4.25.2 was published 2026-05-21, before the repo's first lockfile on 2026-06-08, so `^4.0.0` resolved to it from day one). `pnpm install --frozen-lockfile` reproduces it deterministically.

**Hypothesis (blocked):** that `expo export` succeeds after the pin. I attempted `pnpm --dir apps/mobile add react-native-screens@~4.11.1` as a reversible probe and the session's tool policy refused the workspace change. The parser-level result above is the strongest evidence available without it.

### Blast radius

Blocks T18, T23-mobile, T24, T25-Android, T26, T29 and P10 dogfooding, therefore gate #3 and gate #4. Every other item in this document is reachable without it; nothing that ships to a phone is.

### Options

1. **Pin `react-native-screens` to `~4.11.1` only.** Minimum change, one lockfile entry. Leaves six other packages off-pin, including `react@19.2.7` against a `react-native@0.79` renderer built for React 19.0. A renderer/reconciler minor mismatch is a runtime crash at startup, which the bundle gate cannot see.
2. **`npx expo install --fix` (all seven).** Aligns everything to what SDK 53 was tested with. Touches `react` and `typescript` at the hoisted root, so `apps/web` gets React 19.0.x and TypeScript ~5.8 too (Next 15 is fine with both; `pnpm typecheck` must be re-run). This is the change Expo's tooling would have made on day one.
3. **Upgrade to Expo SDK 54 / RN 0.81+** so `react-native-screens` 4.25 is legitimate. Largest change, invalidates §14 #4's floor analysis, no benefit this month.

### Recommendation

**Option 2**, with `~`/exact pins kept in `apps/mobile/package.json` as written by `expo install` (the `^4.0.0` and `^53.0.0` caret ranges are the root cause class; §14 #4 reasoned about "SDK 53" while the ranges permitted post-SDK-53 releases). Accepting: React and TypeScript move for the web app too; run the full `pnpm lint && typecheck && build` and re-verify `next build`.

### CI gate, and the sequencing that keeps CI green

The gate cannot land before the fix or the `verify` job goes red immediately. One PR, two commits, in this order:

1. **Commit 1 — fix.** `expo install --fix`, regenerate lockfile, `pnpm typecheck` green. CI unchanged, green.
2. **Commit 2 — gate.** Add to `apps/mobile/package.json`:
   - `"build": "expo export --platform android --output-dir dist"` — `turbo run build` picks it up (`dist/**` is already in `turbo.json` outputs and `.gitignore`). Local bundling took 13 s; expect about a minute in CI on top of the existing `verify` job.
   - a `verify` step `pnpm --dir apps/mobile exec expo install --check`. **Hypothesis:** its exit code on mismatch. My run was piped, so I only saw the text `Found outdated dependencies`; if it exits 0, grep the output instead.
3. **Watched fail:** before merging, run commit 2's gate against commit 1's parent (`git stash` the fix or check out `main` with the new script) and record the red run. A gate that has never failed is unproven.

### Definition of done

- `pnpm build` from a clean clone produces `apps/mobile/dist/_expo/static/js/android/*.hbc` (or `.js`) and exits 0.
- `expo install --check` reports no outdated dependencies.
- The `verify` job's log shows the export step, and a linked red run proves the step fails on the pre-fix commit.
- The app launches in an Android emulator or on a device without a red-box (this catches the React renderer mismatch the bundle cannot).

### Test strategy

The gate is the test. Prove it can fail as above. Add one more: a repo test that reads `apps/mobile/package.json` and asserts no native-module dependency uses a `^` range (list: `expo`, `expo-*`, `react-native`, `react-native-*`). It fails on the current file.

### Effort and dependencies

1 day (0.5 fix and gate, 0.5 device launch check). Slips if `@types/react` 19.0.10 changes typings the web app relies on, or if `typescript ~5.8` disagrees with `typescript-eslint@8.11`. No dependencies.

---

## E. The five open decisions in PR #3

**ID / owner / ref:** E · both · §11, §15, T13, T14; PR #3 "Open items"

These need a human, not a developer. Thirty minutes. The PR should not merge before 1 and 5 are acknowledged in writing on the PR; 2, 3 and 4 can be ticketed.

### E1 — Occurrence override route is `PATCH` returning `EventOccurrence`

Resolved in code and both plan documents (§5 already reads `overrideOccurrence(...): Promise<EventOccurrence>` with the PATCH note, so the brief's claim that §5 is stale is itself stale). Wants the §15 two-dev sign-off.

- **Keep (recommended).** `Event` cannot represent a sparse exception without six nulls in non-nullable fields; the `contract-shape` test now pins the honest shape.
- **Revert to `PUT`/`Event`.** Re-opens the null-through-non-nullable hole and forces clients to send whole windows.
- **DoD:** Scott comments "agreed" on PR #3 item 1; the 🔸 marker in §11 becomes ✅ with the date.

### E2 — `/healthz` returns an undeclared 503

Verified: the handler returns `err('INTERNAL_ERROR', …, 503)` on a failed `rpc('healthz')`; `openapi.yaml` declares only `200`.

- **Declare the 503 (recommended).** Add `'503'` with the `ApiError` envelope to `/healthz`, regenerate types. `deploy-staging.yml` already treats non-200 as failure, so nothing changes operationally; the contract stops lying.
- **Leave undeclared.** Every generated client sees a status the spec says cannot happen.
- **Return 200 with `status: "degraded"`.** Rejected: load balancers read status codes.
- **DoD:** `contract.yml` green with the new response; the `healthz` integration test asserts the 200 shape; a runbook note says how to observe the 503 (pause the database container locally and `curl`). Inducing the failure inside the suite is not worth the container gymnastics.

### E3 — `/healthz` omits `version`

- **Add `version` (recommended).** Contract change: `Health.version: string`. Handler reads `Deno.env.get('PLANPAL_VERSION')`; `deploy-staging.yml` sets it with `supabase secrets set PLANPAL_VERSION=$GITHUB_SHA` before `functions deploy`, and the smoke step asserts the returned SHA equals `$GITHUB_SHA`. That turns the smoke check from "something answered" into "the thing I just deployed answered".
- **Drop the claim from §6.** Cheaper, and the deploy proof stays weaker.
- **DoD:** `curl https://<ref>.supabase.co/functions/v1/healthz` returns `"version":"<sha>"` matching `git rev-parse` of the deployed commit; the smoke step fails on a mismatch (watched fail: set the secret to `deadbeef` once).

### E4 — T13's DoD requires a real Google Calendar import

Verified with an independent parser (ical.js 2.x) on `planpal-sample.ics`:

```
VEVENTs: 2 | VTIMEZONE present: false
EXDATE: [ '2026-09-21T09:00:00' ]
  2026-09-07T09:00:00 -> Weekly standup, with notes; and a path C:\work  09:00..09:30
  2026-09-14T09:00:00 -> Standup (moved)                                  11:00..11:30 (override)
  2026-09-28T09:00:00 -> Weekly standup ...                               09:00..09:30
```

The recurrence, override and cancellation all resolve. **But the file references `TZID=America/New_York` with no `VTIMEZONE` component.** RFC 5545 §3.6.5 requires one per referenced TZID. Google Calendar tolerates IANA TZIDs without it; Outlook desktop and some Apple Calendar versions shift or reject. `_shared/ical.ts` never emits `VTIMEZONE` and `export-ical.test.ts` never asserts one, so "RFC 5545 verified by test" is narrower than it reads.

- **Do the import now, twice (recommended).** Google Calendar and Outlook.com, 15 minutes each with a personal account. Expected result: exactly three September occurrences at 09:00, 11:00 (moved), and 09:00, with no event on 2026-09-21. If Outlook shifts the times, `VTIMEZONE` moves from M9 to now.
- **Add `VTIMEZONE` generation first.** 1 day; needs tzdata rules in Deno. Correct, but M9 owns hardening and the import test is the cheaper way to learn whether it is needed for MVP.
- **DoD:** screenshots or an exported list of the imported occurrences from both importers attached to the T13 ticket; T13 marked done only if both match the expected set.

### E5 — `delete_me()` keeps `EXECUTE` for `authenticated`

Verified on the local catalog: `delete_me` is `SECURITY DEFINER`, executable by `authenticated`, not by `public` or `anon`, takes no arguments; `grants.test.ts` carries the allowlist and asserts the signature stays empty.

- **Accept and amend §15 (recommended).** Add: "…unless the function takes no target parameter and derives its subject from `auth.uid()`; every such exception is listed in `grants.test.ts` with its justification." The rule then describes what is enforced.
- **Revoke and use the service-role admin API.** Rejected in §6 and §14 #2 already.
- **Add `p_user_id` with an internal guard.** Strictly worse: the guard can be deleted later; an absent parameter cannot.
- **DoD:** §15 text updated in the same PR; Scott's acknowledgement on PR #3 item 5.

---

## B. `packages/api-client` (T8)

**ID / owner / ref:** B · Arlo · §5, AD-7, AD-9, AD-10; T8 → T18/T19/T20/T29

### Problem

Every screen waits on this package, and its interface was written before the API surface stabilised. Three things are wrong or unaddressed in §5 as written: the "ban bare `fetch`" lint rule cannot be written with `no-restricted-imports`, the 401 path the client must handle is not the one the contract describes, and the cache seam as specified has no read policy or freshness metadata, which is exactly what T29 needs.

### Evidence (verified)

- §5 vs shipped routes, from `openapi.yaml` paths and the handlers: `GET/POST /events`, `GET/PATCH/DELETE /events/{id}` (DELETE → 202 `EmptyResult`), `PATCH /events/{id}/occurrences/{date}` → `EventOccurrenceResult`, `DELETE …/{date}` → 202, `GET /occurrences?from&to` (400 above 180 days: `MAX_RANGE_DAYS = 180` in `packages/recurrence/src/types.ts`), `GET/PATCH/DELETE /me` (DELETE → 202), `GET/PUT /me/notification-preferences`, `POST /me/devices` → `DeviceResult` (409 when the token belongs to another account), `DELETE /me/devices/{token}` → 202, `GET /friend-code`, `POST /friend-code/rotate`, `GET /export/ical` → `text/calendar`, `GET /healthz`.
  - §5 mismatches: `devices.register(): Promise<void>` (API returns `Device`, and the 409 needs a caller-visible error); `export.ical(): Promise<Blob>` (React Native's `fetch` Blob support is partial; return the `string` body); no `health()` method (T29's offline indicator wants one).
- The 401 the client will actually see for an expired or malformed JWT is the **gateway's**, not our envelope:

```
curl -H "Authorization: Bearer not-a-jwt" …/functions/v1/notify-scheduler
{"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT format","msg":"Invalid JWT format"}
HTTP 401
```

`openapi.yaml` says 401 → `Unauthenticated` envelope. The handler's `unauthenticated()` only runs when the gateway passed the request. A client that parses `body.ok` before deciding to refresh will throw on this body.

- `@supabase/supabase-js`, `expo-secure-store` and `openapi-fetch` are not installed anywhere in the workspace (`ls node_modules/@supabase/supabase-js` → not found). The functions import supabase-js from esm.sh; the apps have never held a session.
- The root ESLint config has no `no-restricted-*` rules. `fetch` is a global, so `no-restricted-imports` cannot see it.

### Blast radius

T18, T19, T20 cannot start without it; T29 becomes a rewrite if the cache seam lands without a read policy.

### Options

1. **Hand-rolled `http.ts` over `fetch`, typed per resource from `@planpal/types` (recommended).** About 150 lines. Full control of the refresh path and error mapping; AD-7 semantics are natural.
2. **`openapi-fetch` over the generated `paths` type.** Typed routes for free and one less place to drift, but its middleware model makes "refresh once, retry once, never loop" awkward, and it adds a dependency to both app bundles.
3. **Expose supabase-js's PostgREST client directly.** Rejected: bypasses the Edge Functions, RLS becomes the only guard, and the contract stops mattering.

### Recommendation

Option 1. Accepting: route paths are typed by hand per resource (about 14 routes), verified by the integration test below rather than by the type system.

### Specification deltas to §5

- `http.ts` order: attach `Authorization: Bearer <access>` and `apikey: <anon>`; send; **on any 401 regardless of body shape** refresh once via `auth.refreshSession()` and retry once; if still 401 throw `PlanPalApiError('UNAUTHENTICATED', …, 401)`; if the body is not an `ApiResult` envelope (gateway 401/404/5xx, `text/calendar`), map to `PlanPalApiError` with the status and a synthetic code, never `JSON.parse` blindly.
- `devices.register(token, platform): Promise<Device>`; a 409 surfaces as `PlanPalApiError('CONFLICT')` and the sign-out path calls `unregister` first.
- `export.ical(): Promise<string>`; `health(): Promise<Health>`.
- `occurrences.range(from, to, opts?: { policy?: 'network-first' | 'cache-first' | 'cache-only' })` normalises to whole months, fetches each missing month (chunking any request to ≤ 180 days), stitches, and returns items within `[from, to]`.
- `CacheAdapter` keys `occ:<userId>:<yyyy-mm>` storing `{ fetchedAt: string; items: EventOccurrence[] }`. `set` writes the envelope, not the bare array, so T29 can render a "last updated" state. Any `events.*` write clears `occ:<userId>:*` (a recurring master can touch any month). `auth.signOut()` clears `occ:*` (a shared device must not show the previous user's calendar). In-memory adapter in M3; `AsyncStorage` adapter in T29 (AD-9 bans tokens from AsyncStorage, not calendar data).
- AD-9 gotcha: iOS Keychain via `expo-secure-store` rejects values over 2048 bytes and a supabase-js session JSON is larger. The mobile `SessionStore` must chunk values or persist only the refresh token and keep the access token in memory. Android has no such limit, so this will not show up in Android-only dogfooding.

### Lint enforcement that can fail

- `no-restricted-imports`: `@supabase/supabase-js`, `@supabase/*`, with message "use @planpal/api-client".
- `no-restricted-globals`: `fetch`, same message.
- Scope: `apps/**/*.{ts,tsx}` and `packages/**/*.{ts,tsx}` **except** `packages/api-client/**`, `**/*.test.{ts,tsx}`, `supabase/**`.
- Proof: a Vitest test in `packages/api-client` that runs `new ESLint({ cwd: repoRoot }).lintText(...)` on three snippets — supabase-js import at `apps/web/src/x.ts` (expect 1 error), `fetch('/x')` at `apps/mobile/src/x.ts` (expect 1 error), the same import at `packages/api-client/src/x.ts` (expect 0). Run it before adding the rule and record the failure.

### Definition of done

- Both apps render occurrences fetched through the client against the **local** stack (dev cloud for the manual check).
- The lint test above is green, and its red run before the rule existed is linked.
- The refresh path is proven twice (below).
- `pnpm --filter @planpal/api-client test` enforces ≥ 70 % lines/branches/functions/statements in `vitest.config.ts` (set at creation, §15).

### Test strategy

- **Unit (mocked `fetch`):** 401 → `refreshSession` called exactly once → retry → 200; 401 → refresh → 401 → throws, `fetch` called exactly twice; 401 with a non-JSON body still triggers refresh; `ok:false` maps `code` to `PlanPalApiError.code`; month normalisation of `(2026-01-15, 2026-03-02)` fetches three months and returns only in-range items.
- **Integration (real 401, no waiting an hour):** add `@planpal/api-client` to `supabase/tests`. Sign in a test user, then hand the client an access token **minted locally with the stack's JWT secret** (`super-secret-jwt-token-with-at-least-32-characters-long`, printed by `supabase start`) with `exp` in the past and the user's real `sub`, plus the real refresh token. Call `events.list()`. Expected: gateway 401, refresh, retry, 200. Watched fail: give it a refresh token from a different user; the retry must 401 and throw, not loop.

### Effort and dependencies

3 days as planned. Slips on: the secure-store size limit (0.5 day if discovered late), RN `fetch` differences, and T6 (Google) only for OAuth screens; email/password already works on the cloud project, so B does not wait on T6. Depends on nothing in this document; A should land first only so the package can be smoke-tested on a device.

---

## G. §10's missing `birthday_flag` migration

**ID / owner / ref:** G · Scott · §10, §P4 note, `20260614000001`

### Problem

`sync_birthday_event()` finds and replaces its own row through `color_label = '__birthday__'`. The sentinel is a user-visible colour value and, because `color_label` is an ordinary writable column, a user can break the sentinel, which orphans birthday masters.

### Evidence (verified, live against the local stack)

```
PATCH /me {birthday: "1990-10-14"}            -> 200
GET /occurrences?from=2026-10-01&to=2026-10-31 -> [{"title":"Birthday","colorLabel":"__birthday__",...}]
GET /events                                    -> [{"title":"Birthday","colorLabel":"__birthday__","recurrenceRule":"FREQ=YEARLY"}]
PATCH /events/<birthday id> {colorLabel:"#ff0000"} -> 200
PATCH /me {birthday: "1990-11-02"}             -> 200
GET /events -> TWO "Birthday" masters: one colorLabel "#ff0000" (1990-10-14), one "__birthday__" (1990-11-02)
GET /export/ical -> does not contain "Birthday" (visibility private)
```

Two findings, one new:

1. The sentinel reaches the wire on `/events` and `/occurrences`. `EventBar.eventColor` returns `event.colorLabel` verbatim, so React Native receives `'__birthday__'` as a colour (not run on a device; RN ignores invalid colour strings with a warning, so the bar most likely renders transparent).
2. **New defect:** changing the birthday master's colour detaches it from the sentinel, and the next birthday change leaves the old master behind. Conversely, a user who sets `colorLabel: "__birthday__"` on any event gets it deleted at the next birthday change. Not found by reading; found by running.

Current local state: 4 events, 0 with the sentinel, 4 birthday-related catalog references (two in the migration, one in a comment in `20260902000001`, none in tests).

### Blast radius

`sync_birthday_event` (rewrite), `on_user_birthday_change` (unchanged), `handle_new_user` (unchanged; birthday is null at signup), export (unaffected: `MASTER_COLUMNS` never selects `color_label` and birthdays are private), `notify-scheduler`/`occurrences`/`events` column lists (unchanged unless the flag is exposed), `serialize.ts` `EventRowFull`/`EventModel` (+1 field if exposed; generated automatically after C), `contract-shape.test.ts` `SNAKE_CASE_LEAKS` (+`is_birthday`), the T19 colour picker (must never see the sentinel).

### Options

1. **Boolean column, backfill, protect the flag, expose `isBirthday` on `Event` (recommended).** One migration, one contract field, one serializer line.
2. **Boolean column, do not expose.** Smaller, but T19 has no way to draw the birthday differently or hide its colour picker, and would re-infer from the title.
3. **Move the birthday out of `events` into a computed occurrence.** Clean but touches the engine mirror and every read path. M-later.

### Recommendation

Option 1, exposing `isBirthday` on `Event` only (masters); `EventOccurrence` gets it later if the UI needs it, because that field must pass through the engine's `EventRecord` and the mirror.

### Migration specification — `20260909000002_birthday_flag.sql`

```sql
alter table public.events add column is_birthday boolean not null default false;

-- Backfill. Keep the newest sentinel master per owner; the older ones are the
-- orphans the sentinel design produced (see the probe in docs/M3_M4_SPECS_PLAN.md).
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

create or replace function public.sync_birthday_event(p_user_id uuid) ... -- same body,
--   delete ... where owner_id = p_user_id and is_birthday and is_master;
--   insert ... is_birthday = true, color_label = null
```

Then `pnpm db:reset` proves the chain applies from scratch (§10).

### Definition of done

- `pnpm db:reset` green; `grants.test.ts` still green (the new trigger function is `SECURITY INVOKER` and revoked from PUBLIC).
- `GET /events` after setting a birthday returns exactly one item with `isBirthday: true` and `colorLabel: null`; no response anywhere contains the string `__birthday__` (grep the integration suite's captured bodies).
- Changing the birthday after recolouring the master still yields exactly one birthday master.
- Setting `is_birthday` as `authenticated` via SQL returns SQLSTATE 42501.

### Test strategy

Integration tests in `me.test.ts` (or a new `birthday.test.ts`): the four DoD bullets as tests. The orphaning test **fails on the current tree** (I observed two masters), which is the watched failure. Backfill test: apply migrations through `20260908000001` on a scratch database, insert two sentinel masters for one owner, apply the new migration, assert one remains with the flag and the unique index exists.

### Effort and dependencies

1 day (0.5 migration and tests, 0.5 contract field, regenerate, serializer, `SNAKE_CASE_LEAKS`). None. Must land before T19 builds a colour picker; land after C only if you want the serializer change to come for free.

---

## C. Generated database types (T32)

**ID / owner / ref:** C · Scott · AD-11, T32; F2 (row half)

### Problem

Twenty-three `as unknown as` casts (verified by grep, excluding one comment) hide every mismatch between a query and its row type. A cloud project now exists, so the types can be generated.

### Evidence (verified)

`supabase gen types typescript --local` produced 1123 lines with `Tables.events.Row/Insert/Update`, `Functions.override_occurrence/rotate_friend_code/delete_me/healthz/prune_notification_sends`, and `Enums.visibility`.

Deno consumed it directly, no mirror step: `import type { Database } from './database.types.ts'` inside a file checked with `deno check --config supabase/functions/deno.json`. The output is a self-contained `.ts` with no imports, so the `_shared/recurrence` treatment (rewriting `.js` specifiers and aliases) is unnecessary.

Probe 1 (what the types do and do not fix):

```
const EVENT_COLUMNS = 'id,owner_id,title,description,' + 'is_master,visibility';   // concatenated
client.from('events').select(EVENT_COLUMNS)   -> TS2339 Property 'title' does not exist on type 'GenericStringError'
client.from('events').select('id,owner_id,title,...')  -> typed; a non-selected column is a compile error (@ts-expect-error consumed)
client.from('events').select('*')             -> typed; a misspelled column is a compile error
client.rpc('override_occurrence', ...).maybeSingle()   -> data is `never`
```

Probe 2 (does it remove the casts?):

```
client.rpc('override_occurrence', ...)          -> data typed as the events composite; mapEventRow(data) and toEventModel(data) compile
select('*') rows                                 -> mapEventRow(row) and toEventModel(row) compile
one literal string with all 16 columns          -> mapEventRow(row) compiles
client.rpc('rotate_friend_code')                 -> data.code: string
deno check: 0 errors
```

So: generated types remove **all 23 casts**, provided two mechanical changes: (1) the three concatenated column constants (`occurrences/index.ts:141`, `notify-scheduler/index.ts:325`, `export/index.ts:27,32`) become single string literals (TypeScript widens `'a' + 'b'` to `string`; one literal keeps the literal type); (2) `.rpc(...).maybeSingle()` at `events/index.ts:346` becomes `.rpc(...)` (the RPC returns a composite, not a set). AD-11's claim that a renamed column becomes a compile error is true only after (1); today's runtime-built lists would defeat the generated types silently.

### Blast radius

All seven functions, `_shared/serialize.ts` (six hand-written `*Row` interfaces become `Database[...]['Row']` aliases), `_shared/ical.ts` and `_shared/variable.ts` (four more). `_shared/recurrence/row.ts` stays: it is generated from the package and the probe shows the generated `Row` is assignable to it.

### Options

1. **Commit `supabase/functions/_shared/database.types.ts`, generated from the local stack, with a drift gate (recommended).** Deterministic (derived from migrations, not a cloud project), no credentials in CI, same shape as `contract.yml` and `recurrence:check`.
2. **Generate at build time in CI, never commit.** No drift possible, but local `deno check` needs a running stack, and reviewers cannot see the type change in a diff.
3. **Generate from the cloud project.** Ties CI to a live project and its credentials, and to whatever migration state the cloud happens to have.

### Recommendation

Option 1. Accepting: a `supabase` CLI version change can reformat the output and flap the gate, so **pin the CLI**: replace `npx --yes supabase@latest` in `package.json` scripts and `version: latest` in `ci.yml` with one exact version. This is unpinned today and is a latent flake for the whole integration job, not only for this gate.

### Definition of done

- `grep -rn "as unknown as" supabase/functions --include=*.ts | grep -v _shared/recurrence` returns only comments (target: zero code hits).
- `ci.yml`'s `integration` job runs `supabase gen types typescript --local > supabase/functions/_shared/database.types.ts && git diff --exit-code -- supabase/functions/_shared/database.types.ts` after `supabase start`, and a linked red run shows it failing on a hand-edited file.
- `deno check */index.ts` fails when a column is renamed in a scratch migration (do this once locally and record the error).

### Test strategy

The gate and `deno check` are the tests. Watched failures: (a) edit one line of the generated file → integration job red; (b) `alter table events rename column color_label to colour_label` in a throwaway local migration → `deno check` red at `serialize.ts`, then drop the migration. The 195-test integration suite must stay green throughout, which proves the literal column strings still name the columns the handlers read.

### Effort and dependencies

1 day. Slips if PostgREST composite-return typing differs between supabase-js minors (pin `https://esm.sh/@supabase/supabase-js@2.x.y` at the same time; it is `@2` today). Depends on the CLI pin. Do before D and G so their serializer edits inherit the types.

---

## F. Two structural judgment calls from PR #3

**ID / owner / ref:** F · Scott · §6, §11, `20260903000005`, `_shared/serialize.ts`

### F1 — `rotate_friend_code()` uses the `public.users` row as a mutex

**Evidence (verified):** the only `FOR UPDATE` in the repo is `rotate_friend_code`'s `perform 1 from public.users where id = v_user_id for update`; there are no advisory locks anywhere. `users` grants `authenticated` SELECT/INSERT/UPDATE/DELETE and policy `users_update_self` (`id = auth.uid()`). Lock order today: `handle_new_user` inserts `users` then `friend_codes`; `rotate` locks `users` then writes `friend_codes`; `PATCH /me` updates `users` and its trigger writes `events`. No cycle exists now.

**Why it still matters:** the lock only exists if `FOR UPDATE` on `users` succeeds under RLS. Tightening `users_update_self` (a column-restricted policy for T19 settings, say) makes the `perform` match zero rows, the lock silently disappears, and the 1-in-3 race returns. The M6 friend-by-code redemption is the natural first feature to lock a `friend_codes` row and then touch `users`, which is the deadlock pair.

- **Switch to `pg_advisory_xact_lock(hashtext('rotate_friend_code:' || v_user_id::text))` now (recommended).** New migration `20260909000001`, one line changes, the existing eight-caller concurrency test in `friend-code.test.ts` is the regression. Removes the coupling to `users` grants and policy entirely.
- **Log it, and write the lock-order convention (`users` → `friend_codes` → `friend_connections`) into the migration comment.** Zero code, but a convention nobody enforces is what §15 exists to warn about.
- **DoD:** migration applied by `db:reset`; `friend-code.test.ts` green five consecutive runs; watched fail: comment out the advisory lock locally and observe the concurrency test fail at least once in five runs (it caught the original at roughly one in three).
- **Effort:** 0.25 day.

### F2 — Three copies of `Event`, and a drift gate that diffs only the generated types

**Evidence (verified):** wire/row shapes for events across the functions: `EventModel` and `EventRowFull` (`serialize.ts`), `EventRow` (engine mirror), `IcalEventRow`/`IcalExceptionRow` (`ical.ts`), `VariableMasterRow`/`VariableExceptionRow` (`variable.ts`), plus the spec's `Event`. `contract-shape.test.ts` hardcodes `EVENT_REQUIRED` (13 names) and `OCCURRENCE_REQUIRED` (11). Adding a required property to `openapi.yaml` regenerates `packages/types`, `contract.yml` stays green, the serializer keeps omitting it, and no test notices. The `yaml` package is already installed at the workspace root.

- **Close both halves now (recommended).** Row half: C. Wire half, two parts: (a) `contract-shape.test.ts` reads `required` arrays from `openapi.yaml` at run time instead of the hardcoded lists (0.25 day; it then fails the moment the contract gains a field the serializer omits); (b) generate a Deno-consumable `supabase/functions/_shared/contract-types.ts` from `openapi.yaml` with `openapi-typescript` (already a dev dependency), type `EventModel = components['schemas']['Event']` and friends, add the file to `contract.yml`'s `git diff --exit-code` (0.5 day; `deno check` then fails on a missing required field before any test runs).
- **Log it.** The next contract change is `isBirthday` (G), so the gap will be exercised within the week.
- **DoD:** delete one `required` entry from a local copy of `openapi.yaml` → `contract-shape` fails; add a bogus required field → `deno check` fails at `serialize.ts`. Both recorded.
- **Effort:** 0.75 day. Depends on C for the aliasing to be worth it; (a) can land alone today.

---

## D. `pg_cron` live (T27)

**ID / owner / ref:** D · Scott · §9, T27, `20260614000002`

### Problem

The schedule has never fired anywhere. Enabling it needs `pg_net`, vault secrets, and an answer to how a database-originated HTTP call authenticates against a function deployed with JWT verification on.

### Evidence

Verified locally:

```
pg_available_extensions: pg_cron 1.6.4 installed · pg_net 0.20.4 NOT installed · supabase_vault 0.3.1 installed
cron.job: empty
create extension pg_net → CREATE EXTENSION
net.http_post(url := 'http://supabase_kong_planpal:8000/functions/v1/notify-scheduler', headers := {Content-Type, X-Cron-Secret}) → request_id 1
net._http_response: 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

Gateway behaviour with the same request via curl:

| Headers sent                           | Result                                                         |
| -------------------------------------- | -------------------------------------------------------------- |
| none                                   | 401 `UNAUTHORIZED_NO_AUTH_HEADER`                              |
| `Authorization: Bearer not-a-jwt`      | 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`                          |
| `apikey: <anon>` only                  | **500 `{"error":"Server misconfigured."}`** — the function ran |
| `Authorization: Bearer <anon>`         | 500, function ran                                              |
| `Authorization: Bearer <service_role>` | 500, function ran                                              |

The 500 is the handler's own first branch (`CRON_SECRET` is unset in the local runtime; no `supabase/functions/.env` exists), which is how we know the request crossed the gateway. So the `apikey` header alone satisfies local JWT verification; a missing or garbage bearer does not. Supabase's current scheduling guide sends exactly `apikey: <publishable key>` from the vault.

Verified on the cloud: all seven functions have `verify_jwt: true` (`supabase functions list --project-ref dhsfivkumctnstziokmu`). **Not verified:** whether `pg_net` is enabled and whether any vault secrets exist on `planpal-dev`; I had no SQL access to the cloud project from this session.

The commented snippet in `20260614000002` is wrong twice against current docs: it reads secrets with `current_setting('app.*')` (GUCs, not the vault) and it sends the **service-role key** as the bearer, which §3 confines to function secrets.

### Blast radius

Gate #3 (push on real devices), T26, P8, and the dogfood window's usefulness: without reminders the app is a read-only calendar.

### Options

1. **Keep `verify_jwt = true`; cron sends `apikey: <anon/publishable>` plus `X-Cron-Secret`, both from the vault (recommended).** The gateway keeps rejecting unauthenticated internet callers before a cold start; the anon key is public-safe so storing it in the vault costs nothing; the handler's shared-secret check stays the real gate. Matches the vendor guide.
2. **`[functions.notify-scheduler] verify_jwt = false` in `config.toml`, cron sends only `X-Cron-Secret`.** Simpler request; the function becomes reachable by anyone on the internet up to the secret check, and `config.toml` applies to the local stack too, which is convenient for a local integration test. Acceptable, second choice.
3. **Service-role bearer (the migration's snippet).** Rejected: violates §3, and the key would sit in `cron.job.command` text.

### Recommendation

Option 1. Ship it as migration `20260909000003_enable_notify_cron.sql`: `create extension if not exists pg_net;` then `select cron.schedule('notify-scheduler', '* * * * *', $$ select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_function_url'), headers := jsonb_build_object('Content-Type','application/json','apikey',(select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),'X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')), body := '{}'::jsonb) $$);`. Secrets are read at each tick, so the migration can apply before an operator runs `vault.create_secret` per environment; until then each tick records a visible failure rather than silently doing nothing. Document the three `vault.create_secret` calls in `docs/SECRETS.md` with `CRON_SECRET` added to the inventory (it is missing today), and set the same `CRON_SECRET` as a function secret.

**Hypothesis to confirm on first cloud tick:** that the cloud gateway accepts `apikey` alone as the local one does. The proof is `net._http_response.status_code = 200` for the first scheduled request; if it is 401, fall back to option 2 in the same day.

### Proving delivery without a device

Three layers, each externally checkable with SQL on the target environment:

1. `select status, return_message from cron.job_run_details order by start_time desc limit 5` — `succeeded` every minute.
2. `select status_code, content from net._http_response order by id desc limit 5` — `200` with body `{"dispatched":N,"candidates":M,...}`.
3. Register a device row and create an event two minutes ahead; `select * from notification_sends` gains a row with that `event_id` and `occurrence_date`. A syntactically valid but fake Expo token returns `DeviceNotRegistered` and the row is **pruned** instead, which proves the dead-token path, not delivery. A real Expo push token from a T25-Android dev build is the only proof of delivery, and that is gate #3.

Add `console.log` of tick duration and candidate count so the M10 rewrite starts with data.

### Local integration test

The scheduler has zero tests today (grep `notify-scheduler` in `supabase/tests/src` → none). Add `notify-scheduler.test.ts`: create user, register device with a fake token, create a recurring event whose next occurrence is 90 s ahead with lead time 1 minute, call the function with `X-Cron-Secret`, assert `candidates ≥ 1`; then assert quiet hours suppress it. **Prerequisite (hypothesis):** the local runtime must receive `CRON_SECRET`. The CLI reads `supabase/functions/.env` when present and `.env*` is gitignored, so the `integration` job should write that file (`echo CRON_SECRET=test-cron-secret > supabase/functions/.env`) before `supabase start`, and `docs/TESTING.md` should say so for local runs. Confirm the file is picked up by observing the 500 turn into a 403 for a wrong secret.

### Scale limit (§9)

Confirmed not worth pre-empting. Per tick the function loads all enabled prefs, their devices and users, and every master with `utc_start` before the horizon; the expansion window is at most 30 days (28-day max lead plus a day each side). At 200 users this is a few hundred rows and tens of milliseconds. The M10 materialised queue stands.

### Definition of done

- Migration applied by `db:reset`; `cron.job` has one row named `notify-scheduler`.
- On `planpal-dev`: layers 1 and 2 above show 200s for ten consecutive minutes; layer 3 shows a `notification_sends` row for a test event.
- `notify-scheduler.test.ts` in the suite, with a recorded failure when `X-Cron-Secret` is wrong (403) and when the local env file is absent (500).
- `docs/SECRETS.md` lists `CRON_SECRET`, `notify_function_url`, `anon_key` (vault) with rotation owner.

### Effort and dependencies

1.5 days. Slips on cloud vault permissions and on the `.env` loading question. Depends on T11 (done) and on an operator with dashboard access to run `vault.create_secret` on dev. Do after C so the handler's column list is a literal already.

---

## H. App test runners and the Playwright journey (T23)

**ID / owner / ref:** H · Arlo · §13, §P7, T23

### Problem

Neither app has a `test` script, so `turbo run test` skips both; no browser-testing or component-testing library is installed. The Playwright journey §P7 names (sign up → recurring event → override one → see it) requires event management on web, which is T28 in Month 4, so as written it cannot exist in Month 3.

### Evidence (verified)

- `apps/web/package.json` and `apps/mobile/package.json`: scripts `dev/build/start/lint/typecheck/clean` and `start/android/ios/web/lint/typecheck/clean`. No `test`.
- Not installed anywhere in the workspace: `@playwright/test`, `playwright`, `@testing-library/*`, `jsdom`, `happy-dom`, `jest-expo`. Installed: `vitest@2.1.3`, `@vitest/coverage-v8` at the root.
- `apps/web/src/app/page.tsx` is the Phase 3 scaffold; there is no calendar on web yet (T20).
- `supabase/config.toml`: `enable_confirmations = true`, so a real sign-up needs the confirmation email from Mailpit (`http://127.0.0.1:54324`).
- Calendar logic is already out of the components: `calendar-core` has 94 tests at 99 % lines.

### Options

**Web runner**

1. **Vitest + `@testing-library/react` + `jsdom` (recommended).** Same runner as the packages; `apps/web/vitest.config.ts` with `environment: 'jsdom'`, `include: ['src/**/*.test.tsx']`. No coverage threshold (docs/TESTING.md: app UI is component + E2E tested, not line-targeted), but at least one real test so the script is not vacuous.
2. Jest. Rejected: a second runner for no reason.

**Mobile runner — this is a decision, not a default**

1. **`jest-expo` for `apps/mobile` only.** The ecosystem-standard way to test RN components; Vitest cannot transform React Native's untranspiled Flow sources. A second runner, which CLAUDE.md says to ask before introducing.
2. **Vitest scoped to `src/lib/**` and pure hooks, RN excluded, with A's bundle gate as the "test".\*\* No new framework; component rendering stays untested on mobile, which is the platform that matters most.
3. Detox/Maestro on-device E2E. Out of scope until T25.

Recommendation: option 1 for mobile as the documented exception to the one-runner rule, because option 2 leaves the calendar screens untested until Playwright can reach them, and it cannot on mobile. **Decision D-H for the team.**

**Playwright journey**

Split it into two stages and say so in §P7:

- **Stage 1 (Month 3, after T7 and T20):** sign in on web → calendar shows a recurring event with one override at its moved time and one cancelled date absent. The event and its override are seeded through the API (the integration harness's `callFn`) because web has no event form yet. Sign-up itself is one separate test that fetches the confirmation link from Mailpit's API (`GET /api/v1/messages`) and follows it.
- **Stage 2 (Month 4, after T28):** the full UI journey exactly as §P7 names it.

Environment: the **local stack only** (docs/TESTING.md forbids tests against cloud). Playwright's `webServer` starts `next dev` with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and the demo anon key. Authentication: a test user created through the GoTrue admin API (as the harness does), signed in through the real UI once, `storageState` saved and reused. CI: an `e2e` job after `integration` that reuses the started stack, with `playwright install --with-deps chromium`.

### Definition of done

- `pnpm test` runs a non-empty suite in both apps (Turbo lists them).
- Stage 1 Playwright passes in CI against the local stack; a red run exists where the seeded override time was changed from 11:00 to 10:00 and the assertion failed.
- `docs/TESTING.md` records the mobile runner decision and the two-stage journey.

### Test strategy

Component tests: `Button`/`Text` render on both platforms; the web month grid renders 42 cells for a given month via `calendar-core` (once T20 exists). Playwright: assert on the moved time text and on the absence of the cancelled date's event, not on "the page loaded".

### Effort and dependencies

3 days (the plan says 2; `jest-expo` transform configuration in a pnpm-hoisted monorepo routinely costs the extra day). Depends on A (mobile), T7 and T20 (stage 1), T28 (stage 2). Slips on Mailpit API shape and `next dev` startup time in CI.

---

## I. Month 4 readiness

**ID / owner / ref:** I · both · P8–P12, T25 (Android), T26 (FCM), T28–T31

Dates use the anchor above; if D-0 lands on a different week, shift every date by the same offset.

### What is genuinely blocked, and what is not

| Item                                         | Blocked by Apple?    | Blocked by anything else?                  | Earliest safe start                    |
| -------------------------------------------- | -------------------- | ------------------------------------------ | -------------------------------------- |
| T25-Android (EAS dev client)                 | No                   | A (bundle), Expo account, Firebase project | week of 09-14 (wk 11) once A is merged |
| T26-FCM                                      | No                   | T25-Android, D (cron live), T11 (done)     | wk 12                                  |
| T28 web event management                     | No                   | T20, B                                     | wk 13 (10-28 is too late; see below)   |
| T29 offline read-only                        | No                   | B's cache seam (policy + `fetchedAt`), T18 | wk 13                                  |
| T30 backup + tested restore                  | No                   | a cloud project (exists: `planpal-dev`)    | **now**                                |
| T31 bug bash / matrix / testers              | Partly (iOS devices) | T25–T29                                    | wk 14                                  |
| T24 Sentry/PostHog plugins                   | No                   | A                                          | wk 11                                  |
| T25-iOS, T26-APNs, TestFlight, Apple Sign-In | **Yes**              | T3                                         | out of scope                           |

### T25-Android specification

`eas.json` with a `development` profile (`developmentClient: true`, `distribution: internal`, `android.buildType: apk`); `expo-dev-client` and `expo-notifications` installed with `expo install`; `android.package` is already `com.planpal.app`; a Firebase project with an Android app of that id; `google-services.json` referenced from `app.json` (`android.googleServicesFile`) and supplied through an EAS file secret, not committed; FCM V1 service-account JSON uploaded under EAS credentials. Dogfood requires an Android handset per dev. **Decision D-I: does each dev have an Android device?** If one is iPhone-only, that dev's half of gate #4 and gate #3 is Apple-blocked, and the plan should say so rather than discover it in wk 14.

DoD: both devs install a dev-client APK from an EAS build URL; the app registers a push token via `POST /me/devices` on launch (visible as a `devices` row); a reminder for a recurring event arrives with the app backgrounded (gate #3, Android half).

### Arithmetic for gate #4

Arlo's chain to an installable, useful build: A (1) → B (3) → T7 auth screens (3) → T18 mobile on real data (2) → T25-Android (2) = **11 ideal days**, about 2.5 calendar weeks at the plan's own 20–30 % reserve. From Mon 09-07 that lands around **Fri 09-25 (wk 12)**, one week before the 10-04 deadline. Any slip over five working days makes the wk-13 date miss, and dogfooding starting later than Mon 10-12 cannot reach 14 consecutive days by 10-25.

### What must be true at the two dates

**End of wk 13 — Sun 2026-10-04**

- Both devs have the dev-client APK installed and signed in; `devices` has a row per phone.
- `notify-scheduler` is scheduled on the environment the phones point at (dev is acceptable for dogfooding; staging requires T2), and layer 1–3 checks from D are green.
- T18 done: real occurrences, create, override, cancel from the phone.
- T30 restore rehearsal completed and dated (it has no dependency on any of the above; do it in wk 10–11 so P12 is not carrying risk).

**End of wk 14 — Sun 2026-10-11**

- T28 and T29 merged; freeze declared in writing.
- Dogfood log has entries from both devs for at least the first day (start no later than Mon 10-12).
- Stage 1 Playwright and both app runners in CI.
- Tester recruiting under way (lead time, not engineering time; §Risks).

### T30 specification (start now)

Confirm the plan tier: Supabase free tier has no automated backups; the Pro tier gives daily backups and PITR as an add-on. Whichever tier, the rehearsal is: `supabase db dump --project-ref <dev> -f dump.sql` (schema) plus `--data-only`, restore into a fresh local stack (`pnpm db:start` on a clean project id, `psql < dump.sql`), then compare `select count(*) from each public table` and run `grants.test.ts` and `rls.test.ts` against the restored database. Record the date, duration and any manual step in `docs/BOOTSTRAP.md`. That is gate #7.

### Effort

T25-Android 1.5 days, T26-FCM 0.5 day (Android half), T28 3, T29 2.5, T30 1.5, T24 1, T31 8 shared. Slips: Firebase console access, EAS build queue times, the `expo-secure-store` size limit surfacing only on iOS later.

---

## Rollup

### Revised critical path

```
A (1d) ─► B (3d) ─► T7 (3d) ─► T18 (2d) ─► T25-Android (1.5d) ─► dogfood starts ≤ Mon 10-12 ─► gate #4 10-25
                 └─► T20 (4d) ─► T28 (3d) ─► freeze 10-11
Scott, fully parallel:  E (decide) · G · C · F · D · T30 · T2 · T6
```

What genuinely parallelises: everything Scott owns. Nothing on Arlo's line does, except T20 alongside T7/T18 if T8 lands first. The plan's stated chain (`T1 → T2 → T6 → T7 → T8 …`) puts T6 (Google provider) ahead of T8; it is not a real dependency, because email/password already works on the cloud project and B needs no OAuth. Start B today.

### Decisions (human) versus work (developer)

| Decision                    | Needed by                           | Recommended answer                                     |
| --------------------------- | ----------------------------------- | ------------------------------------------------------ |
| D-0 week anchor             | today                               | wk 9 = week of 2026-08-31                              |
| E1 override route           | PR #3 merge                         | keep `PATCH`/`EventOccurrence`                         |
| E2 healthz 503              | T9 follow-up                        | declare it                                             |
| E3 healthz version          | T9 follow-up                        | add, injected from `$GITHUB_SHA`                       |
| E4 T13 import               | this week, 30 min with two accounts | do it; VTIMEZONE moves up only if Outlook fails        |
| E5 delete_me grant          | PR #3 merge                         | accept, amend §15                                      |
| D-H mobile test runner      | before T23                          | `jest-expo` as the one exception                       |
| D-I Android devices per dev | before wk 12                        | confirm, or record the Apple block on gate #4          |
| CLI version pin             | with C                              | pin one exact `supabase` CLI version in scripts and CI |

Everything else above is work with a named owner.

### Things the plan is wrong about, with evidence

1. **§P7's Playwright journey needs T28 (Month 4).** Web has no event form in Month 3 (`apps/web/src/app/page.tsx` is the scaffold; §P5 is read-only by design). Split into two stages (H).
2. **§5's lint rule cannot ban `fetch` with `no-restricted-imports`.** `fetch` is a global; `no-restricted-globals` is the rule (B).
3. **AD-11 overstates what generated types fix.** They fix nothing while column lists are built by concatenation; the probe shows `GenericStringError` survives `createClient<Database>`. Two mechanical edits make the claim true (C).
4. **§9/`20260614000002`'s cron snippet is wrong twice:** GUCs instead of the vault, service-role bearer instead of the anon key. The gateway rejects a header-less call with 401 (D).
5. **T13 "RFC 5545 verified"** omits `VTIMEZONE`, which the RFC requires for every referenced TZID (E4).
6. **§14 #4 "SDK 53 floor, no plan change"** reasoned about the SDK while `^` ranges allowed post-SDK native modules; that is the mobile bundle failure (A).
7. **The 401 the client sees is not the contract's.** Expired or malformed JWTs get the gateway's `{"code":"UNAUTHORIZED_…"}` body, not the `ApiResult` envelope. AD-7's client must handle non-envelope 401s (B).
8. **The birthday sentinel is user-writable**, producing orphaned birthday masters. New defect, reproduced live (G).
9. **`docs/BOOTSTRAP.md` says Node 20**; `package.json` engines and CI say 22. Stale doc; fix when touched.
10. **The `supabase` CLI is unpinned** (`npx supabase@latest`, `version: latest`). Any drift gate on generated output will flap, and the integration stack itself changes under the team without a commit (C).
11. **The brief's own claim that §5's `overrideOccurrence` is stale** is out of date: §5 on this branch already reads `PATCH` returning `EventOccurrence`. Nothing to change there.

### Close-out

Probes deleted or reverted; the local stack is left running with the schema as `db:reset` produced it (`pg_net` dropped, no cron jobs, the probe user removed). Nothing was committed.
