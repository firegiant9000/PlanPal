# PlanPal — Implementation Plan (Months 3–4)

**Scope:** the engineering detail behind [MONTH_3_4_PLAN.md](MONTH_3_4_PLAN.md). That document says _what_ and _when_; this one says _how_, with the interfaces, schemas and decisions settled up front so neither dev is inventing them mid-sprint.
**Audience:** Arlo + Scott. Assumes the Month 2 branch (PR #2) is merged.
**Status:** §14's five open questions were all decided on 2026-09-02 — see that section for the record. Remaining 🔸 markers denote **contract changes** (AD-4, AD-8, §11) whose spec edits land in T9, not undecided questions.

---

## 0. How to use this document

- **§1 Architecture decisions** are the load-bearing calls. Read them first; several close bugs that are currently latent in the codebase.
- **§2–§11** are per-workstream specs. Each names the files to create, the interfaces to implement, and its definition of done.
- **§12** is the task table — IDs, dependencies, owners, estimates. That's the thing to work from day to day.
- Estimates are **ideal engineering days for one dev**, excluding the 20–30% non-feature reserve. They assume no context-switching, which is a lie, so treat the totals in §12 as a floor.

---

## 1. Architecture decisions

### AD-1 — One recurrence engine, mechanically mirrored ✅ _implemented_

`packages/recurrence` is the sole implementation. Deno cannot resolve its `./x.js` specifiers or the `@planpal/types` alias, so `scripts/sync-recurrence-edge.mjs` generates a Deno-resolvable copy into `supabase/functions/_shared/recurrence/`, and `pnpm recurrence:check` fails CI on drift.

**Consequence:** never write recurrence logic inside an Edge Function. If the engine needs a capability, add it to the package, add tests, re-sync.

### AD-2 — Two new shared packages, not one

```
packages/api-client     transport, auth, errors, cache seam    (depends on @planpal/types)
packages/calendar-core  pure calendar maths + holidays         (zero dependencies)
```

They are split because they have different test strategies and different consumers. `calendar-core` is pure and unit-testable to a high bar; `api-client` needs mocking. Merging them would drag network mocks into what should be a pure-function suite.

### AD-3 — Web parity via shared logic + separate views ✅ _confirmed 2026-09-02_

**Not** `react-native-web`. RNW would need `transpilePackages` and a `react-native` → `react-native-web` alias in Next, has SSR pitfalls, ships a large bundle, and a `PanResponder` swipe-up sheet is not a desktop interaction.

Instead: all maths and rules live in `calendar-core`; each platform writes its own views. This is the pattern the repo already chose for `@planpal/ui`'s `Button`/`Text` contracts.

**Consequence:** markup is written twice. That is the accepted cost. Logic written twice is not — if a rule appears in both a `.tsx` on web and a `.tsx` on mobile, it belongs in `calendar-core`.

### AD-4 — Profile timezone never rewrites stored events 🔸 _contract change_

`openapi.yaml` currently states that `PATCH /me` with a new `timezoneId` recomputes `utcStart`/`utcEnd` for all the user's events. **Implemented literally this corrupts calendars** — a 9am New York meeting would become 9am London after the user travels.

Correct model:

| Change                                       | Effect on stored events                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `users.timezone_id` (profile)                | **None.** It is the default for _new_ events and the display zone                 |
| `events.timezone_id` (one event)             | Recomputes `utc_*` — already handled by the `events_derive_utc` trigger on update |
| tzdata release changes a country's DST rules | Future events' `utc_*` go stale → a maintenance job, not a request side-effect    |

**Action:** amend the `PATCH /me` description in the spec, regenerate types, and add a test asserting a profile timezone change leaves every `events` row untouched.

### AD-5 — `utc_start`/`utc_end` are an index approximation, never user-visible

`events_derive_utc()` uses Postgres `AT TIME ZONE`; the engine applies an explicit gap/fold policy (gaps shift forward, folds take the earlier instant) and **ignores the stored value**. They can disagree by one hour, twice a year.

Rather than reimplement the engine's policy in PL/pgSQL, we declare the engine authoritative for anything a user sees, and `utc_*` authoritative only for range-scans and conflict detection.

**Action:** update the column comments, and add a test asserting the two agree for all times outside a gap/fold hour.

### AD-6 — `apps/api` is deleted ✅ _done 2026-09-02 (T5)_

It holds a 14-line file that explicitly is not a runtime entry point, while the real backend lives in `supabase/functions`. A placeholder workspace mirroring nothing is how the duplicate engine happened. Delete it; `supabase/functions` is the API.

### AD-7 — The client throws; it does not return result objects

The wire format stays `ApiResult<T>` (`{ok:true,data}` / `{ok:false,error}`). The client unwraps it: methods resolve to `T` or throw `ApiError`. React code then uses ordinary error boundaries and `try/catch` rather than branching on `.ok` at every call site.

```ts
class PlanPalApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'PlanPalApiError';
  }
}
```

### AD-8 — Error codes become a contract enum 🔸 _contract change_

`openapi.yaml` describes `code` as "see enum in README" — and neither the spec nor the README enumerates one. The client cannot switch on codes type-safely.

Add to the spec, matching what the Edge Functions already emit:

```
UNAUTHENTICATED · FORBIDDEN · NOT_FOUND · VALIDATION_ERROR
CONFLICT · METHOD_NOT_ALLOWED · RATE_LIMITED · INTERNAL_ERROR
```

Regenerate; `ApiErrorCode` then comes from the generated types.

### AD-9 — Session storage per platform, one interface

Supabase's JS client needs a storage adapter. Web uses its default (localStorage); mobile uses `expo-secure-store`. **Tokens do not go in `AsyncStorage`** — it is unencrypted, and this is a refresh token.

### AD-10 — Offline cache is keyed by month, behind the client

`GET /occurrences` takes an arbitrary `(from,to)`. Caching that verbatim means a cache that never hits twice. The client normalises reads to whole calendar months, caches per month, and stitches ranges. Built in M3 as a seam; populated in M4.

### AD-11 — Generate database types; stop asserting row shapes

The Edge Functions currently assert `as unknown as EventRow[]` on every query result. That is not a style choice — `supabase-js` parses the `.select()` string at the type level, and our runtime-built column lists degrade its inference to `GenericStringError[]`. The cast silences it, and with it every genuine mismatch between a query and the row type.

`supabase gen types typescript` produces a `Database` type from the live schema; `createClient<Database>(...)` then types `.from('events').select()` properly, and a column renamed in a migration becomes a compile error rather than a runtime `undefined`.

**Consequence:** T32. Until it lands, every widening cast carries a comment saying why — an unexplained `as unknown as` is indistinguishable from a bug.

---

## 2. Module topology

```
packages/
  api-client/          NEW   src/{client,auth,errors,cache,resources/*}.ts
  calendar-core/       NEW   src/{grid,layout,holidays,format}.ts
  recurrence/                unchanged (engine + Deno mirror source)
  types/                     unchanged (regenerated after §11 contract changes)
  design-tokens/  ui/        unchanged
apps/
  web/                 grows src/{app,components/calendar,components/event,lib}
  mobile/              grows src/{lib/session,components/auth}
  api/                 DELETED (AD-6)
supabase/
  functions/           grows me/, devices/, friend-code/, export-ical/, healthz/
  migrations/          + 3 new (see §10)
  tests/               NEW   integration suite against the local stack
```

---

## 3. Environments & secrets (P0 · Scott)

Three Supabase projects: `planpal-dev`, `planpal-staging`, `planpal-prod`.

| Secret                                             | dev | staging | prod | Consumed by               |
| -------------------------------------------------- | --- | ------- | ---- | ------------------------- |
| `SUPABASE_URL` / `ANON_KEY`                        | ✔   | ✔       | ✔    | both apps, Edge Functions |
| `SUPABASE_SERVICE_ROLE_KEY`                        | ✔   | ✔       | ✔    | `notify-scheduler` only   |
| `CRON_SECRET`                                      | ✔   | ✔       | ✔    | `notify-scheduler` auth   |
| `EXPO_ACCESS_TOKEN`                                | —   | ✔       | ✔    | Expo Push                 |
| Google OAuth client id/secret                      | ✔   | ✔       | ✔    | Supabase Auth             |
| Apple team id / key id / private key / Services ID | —   | ✔       | ✔    | Supabase Auth             |
| `SENTRY_DSN`, `POSTHOG_KEY`                        | —   | ✔       | ✔    | both apps                 |

Rules: anon keys may ship in the client; **the service role key exists only in Edge Function secrets and never in a repo, a client bundle, or CI logs**. `.env.example` documents names only.

**DoD:** three projects exist, migrations applied to dev + staging, `docs/SECRETS.md` lists every key and its rotation owner, and a deploy to staging actually deploys something.

---

## 4. Auth (P1)

### Backend (Scott)

Enable email/password, Google, Apple in each project. Redirect URLs:

```
web        https://<host>/auth/callback
mobile     planpal://auth/callback        (scheme already in app.json)
```

`handle_new_user()` already creates the `users`, `notification_preferences` and `friend_codes` rows and synthesises a username, so no schema work is needed. Two things to verify:

1. It is `SECURITY DEFINER` — confirm it has **no** `EXECUTE` grant to `public`/`anon`/`authenticated`. It is trigger-invoked and needs none. _(This is the same class of hole found in M2's scheduler.)_
2. A provider that returns no email, or a duplicate signup, must not leave an `auth.users` row without a `public.users` row. Test both.

### Client (Arlo)

`packages/api-client/src/auth.ts` owns the session; screens never touch `supabase-js`.

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

Screens: `sign-in`, `sign-up`, `forgot-password`, `auth/callback`. Route guarding via an `expo-router` layout guard on mobile and a middleware/layout check on web.

**DoD:** all three providers work on web and a physical device; the session survives a cold start; an expired access token refreshes without the user noticing; an unauthenticated user cannot reach a calendar route.

---

## 5. `packages/api-client` (P2 · Arlo)

The single path from either app to the backend.

```
src/
  client.ts       createPlanPalClient() — composition root
  http.ts         fetch wrapper: base URL, auth header, ApiResult unwrap, retry
  errors.ts       PlanPalApiError + code mapping                     (AD-7, AD-8)
  auth.ts         AuthClient + SessionStore                          (AD-9)
  cache.ts        CacheAdapter interface + in-memory default         (AD-10)
  resources/
    events.ts  occurrences.ts  profile.ts  devices.ts
    notificationPreferences.ts  friendCode.ts  export.ts
```

```ts
export interface PlanPalClient {
  auth: AuthClient;
  events: {
    list(params?: { limit?: number; cursor?: string }): Promise<Paginated<Event>>;
    create(input: EventCreate): Promise<Event>;
    get(id: string): Promise<Event>;
    update(id: string, patch: EventUpdate): Promise<Event>;
    remove(id: string): Promise<void>;
    overrideOccurrence(id: string, date: string, patch: OccurrenceOverride): Promise<Event>;
    cancelOccurrence(id: string, date: string): Promise<void>;
  };
  occurrences: {
    /** Normalised to whole months internally, then stitched. See AD-10. */
    range(from: string, to: string): Promise<EventOccurrence[]>;
  };
  profile: {
    get(): Promise<Profile>;
    update(p: ProfileUpdate): Promise<Profile>;
    remove(): Promise<void>;
  };
  devices: {
    register(token: string, platform: Platform): Promise<void>;
    unregister(token: string): Promise<void>;
  };
  notificationPreferences: {
    get(): Promise<NotificationPreference>;
    update(p: NotificationPreference): Promise<NotificationPreference>;
  };
  friendCode: { get(): Promise<FriendCode>; rotate(): Promise<FriendCode> };
  export: { ical(): Promise<Blob> };
}

export interface CacheAdapter {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  clear(prefix?: string): Promise<void>;
}
```

`http.ts` responsibilities, in order: attach `Authorization: Bearer`, send, on `401` refresh once and retry once (never loop), parse the `ApiResult` envelope, throw `PlanPalApiError` on `ok:false`, return `data` otherwise.

**Enforcement:** add an ESLint `no-restricted-imports` rule banning `@supabase/supabase-js` and bare `fetch` outside `packages/api-client`. The rule is what keeps the house convention true in six months.

**DoD:** both apps fetch occurrences through the client against dev; a forced-expiry test proves the refresh path; the lint rule fails a deliberate violation.

---

## 6. Remaining API surface (P4 · Scott)

One Edge Function per resource group, using the existing `_shared/auth.ts` and `_shared/response.ts` (`dbError` already maps SQLSTATEs and preserves CORS).

| Function      | Routes                                           | Notes                                                                                                                      |
| ------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `healthz`     | `GET /healthz`                                   | No auth. Returns version + a trivial DB round-trip                                                                         |
| `me`          | `GET`/`PATCH`/`DELETE /me`                       | PATCH validates username uniqueness → `409 CONFLICT`; timezone per AD-4. DELETE below                                      |
| `me`          | `GET`/`PUT /me/notification-preferences`         | Validate lead times against the `0..40320` column check _before_ insert so it is a 400, not a 500                          |
| `devices`     | `POST /me/devices`, `DELETE /me/devices/{token}` | Idempotent upsert on `expo_push_token` (it is the PK); bump `last_seen_at`                                                 |
| `friend-code` | `GET /friend-code`, `POST /friend-code/rotate`   | Rotate = stamp old `expires_at = now() + 30d`, insert new. Do it in one RPC — two statements race the partial unique index |
| `export-ical` | `GET /export/ical`                               | Returns `text/calendar`; needs a raw-response path, not `ok()`                                                             |

**`DELETE /me` is not trivial.** `public.users` cascades from `auth.users`, but the Edge Function's user-scoped client cannot delete an `auth.users` row. **Decided 2026-09-02: a `SECURITY DEFINER` RPC performing a hard delete** — **with `revoke execute from public, anon, authenticated` and an `auth.uid() = p_user_id` guard inside, both in the same migration.** Not a service-role admin call: that key is scoped to `notify-scheduler` only (§3) and does not belong in a user-facing function. Not soft-delete-then-purge either — it would put a `deleted_at` filter on every read path, RLS policy and the scheduler, which is new surface to get wrong. Returns `202 Accepted` per the contract.

**`export/ical` scope for M3:** `VEVENT` per master with `RRULE` passed through, `EXDATE` for cancelled occurrences, and a separate `VEVENT` with `RECURRENCE-ID` per override. Non-private events only. The standards-compliant hardening is M9.

**Also in this workstream:** swap `generate_friend_code()` from `random()` to `gen_random_bytes()`. Cheap, and a predictable PRNG is the wrong primitive for something gating calendar access.

---

## 7. `packages/calendar-core` (P5 · Arlo)

Extract **before** writing any web view. The logic currently sits inside `apps/mobile/src/components/calendar/*` and `src/lib/*`, where the web app cannot reach it.

```ts
// grid.ts — from apps/mobile/src/lib/calendarUtils.ts
export function buildMonthGrid(year: number, month: number): CalendarDay[][]; // always 6x7
export function buildWeekDays(anchorDate: string): CalendarDay[]; // DST-safe stepping
export function today(): string;

// layout.ts — currently trapped inside EventBar/DayTimeSheet
export interface PositionedOccurrence {
  occurrence: EventOccurrence;
  topFraction: number;
  heightFraction: number; // of a 24h day
  column: number;
  columnCount: number; // overlap packing
}
export function layoutDay(occurrences: EventOccurrence[]): PositionedOccurrence[];

// holidays.ts — from apps/mobile/src/lib/usHolidays.ts
export function getHolidayName(date: string): string | undefined;

// format.ts
export function fmtTime(localDateTime: string): string;
export function fmtMonthHeader(year: number, month: number): string;
export function fmtDayLabel(date: string): string;
```

`layoutDay` is the important one: overlap-column packing is real logic, it is currently interleaved with JSX, and it is exactly what must not fork across platforms.

**Coverage bar: ≥90%**, matching `recurrence`. It is pure, so there is no excuse. Add the threshold to its `vitest.config.ts` when the package is created — the M2 review found that documented-but-unenforced thresholds are worth nothing.

**DoD:** mobile components import from `calendar-core` and contain no date or layout maths; the package is at ≥90%; `apps/mobile/src/lib/calendarUtils.ts` and `usHolidays.ts` are deleted, not duplicated.

---

## 8. Screens (P3, P4, P5, P9 · Arlo)

| Screen                                                              | Platform | Lands |
| ------------------------------------------------------------------- | -------- | ----- |
| Sign in / up / forgot / callback                                    | both     | P1    |
| Calendar (month, week strip, day sheet) on real data                | mobile   | P3    |
| Onboarding (username, name, avatar, birthday, visibility, timezone) | both     | P4    |
| Settings (notifications, visibility, timezone, account, export)     | both     | P4    |
| Friend code (QR + share sheet)                                      | both     | P4    |
| Calendar read-only                                                  | web      | P5    |
| Event create/edit, occurrence override/cancel                       | web      | P9    |

Two details that will otherwise cost a debugging session each:

- **Avatar upload path must be `avatars/<user_id>/<file>`.** The storage RLS policy keys on the first path segment; anything else fails with a policy violation rather than a useful message.
- **Sensitive-public** renders a grey `busyBlock` with time and duration only. This is the _owner's own_ view — it is presentation, not privacy. Server-side redaction is M7 and must land before any shared view reaches a tester.

---

## 9. Push pipeline end-to-end (P8 · both)

The chain, in dependency order — every link is currently missing:

```
POST /me/devices  →  devices row  →  pg_cron tick  →  notify-scheduler
   (P4, Scott)        (exists)        (P8, Scott)      (built, untested live)
        ↑
   expo-notifications registration in an EAS dev build (P8, Arlo)
        ↑
   APNs key + FCM credentials (P8, needs the Apple account from P0)
```

- **EAS dev build is mandatory** — push no longer works in Expo Go on Android (SDK 53+). It is also what TestFlight needs, so it is not throwaway work.
- **Enable the cron schedule.** It is committed but commented out in `20260614000002`; needs `pg_net`, the function URL and `CRON_SECRET` in the vault.
- **Verify with a recurring event**, not a one-off. The bug this replaces was that recurring events notified exactly once.

**Known scale limit:** the scheduler expands occurrences per user, per minute. Correct at 10–200 users, and it will not survive M10's 10,000-account load test. That rewrite (a materialised upcoming-occurrence queue) is already logged against M10 — do not pre-optimise it now.

**DoD:** a reminder for a _recurring_ event arrives on a physical iOS and a physical Android device with the app backgrounded; quiet hours suppress correctly across an overnight window; a deregistered token is pruned from `devices`.

---

## 10. Migrations

Forward-only, per `docs/BOOTSTRAP.md`. Three new:

| Migration                    | Purpose                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `..._events_utc_comment.sql` | Record AD-5: `utc_*` is an index approximation; the engine is authoritative for user-visible values                                                    |
| `..._birthday_flag.sql`      | Replace the `color_label = '__birthday__'` sentinel with `events.is_birthday boolean not null default false`; backfill; update `sync_birthday_event()` |
| `..._friend_code_csprng.sql` | `generate_friend_code()` uses `gen_random_bytes()`                                                                                                     |

Plus, if `DELETE /me` takes the RPC route (§6), a fourth adding it — with its `revoke execute` lines in the same migration, not a follow-up.

Run `pnpm db:reset` after each to prove the chain applies from scratch.

---

## 11. Contract changes 🔸 _both-dev sign-off required_

| Change                                                          | Why                                                               |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Amend `PATCH /me` timezone description                          | AD-4 — currently specifies behaviour that would corrupt calendars |
| Add `ErrorCode` enum                                            | AD-8 — the spec references an enum that exists nowhere            |
| Add `isVariableSchedule` to `EventOccurrence` ✅ _decided: add_ | The endpoint returns it, the schema omits it, mobile consumes it  |

Each: edit `openapi.yaml` → `pnpm contract:generate` → commit the regenerated types. `contract.yml` fails if they drift.

---

## 12. Task table

Estimates are ideal days for one dev. **S**=Scott, **A**=Arlo.

| ID  | Task                                                       | Own  | Deps        | Est  | Done when                                 |
| --- | ---------------------------------------------------------- | ---- | ----------- | ---- | ----------------------------------------- |
| T1  | Merge PR #2 after `db:reset`                               | both | —           | 0.5  | CI green on main                          |
| T2  | Three Supabase projects + secrets                          | S    | —           | 1.5  | §3 DoD                                    |
| T3  | Apple Developer enrolment                                  | A    | —           | 0.5  | Submitted (then ~2wk wait)                |
| T4  | Fix or delete `deploy-staging.yml`                         | A    | T2          | 0.5  | Staging deploy does something             |
| T5  | Delete `apps/api` (AD-6)                                   | S    | T1          | 0.25 | Workspace gone, build green               |
| T6  | Auth providers + `handle_new_user` verification            | S    | T2          | 2    | §4 backend DoD                            |
| T7  | Auth screens + session + route guards                      | A    | T6          | 3    | §4 client DoD                             |
| T8  | `packages/api-client` skeleton (http, errors, auth, cache) | A    | T7          | 3    | §5 DoD                                    |
| T9  | Contract changes + regenerate (§11)                        | both | T1          | 1    | `contract.yml` green                      |
| T10 | `healthz`, `me`, notification-preferences                  | S    | T2          | 2    | Integration tests green                   |
| T11 | `devices` endpoints                                        | S    | T10         | 1    | Idempotent upsert tested                  |
| T12 | `friend-code` + rotate RPC + CSPRNG                        | S    | T10         | 1.5  | Rotation race-free                        |
| T13 | `export/ical` (M3 scope)                                   | S    | T10         | 2    | `.ics` imports into Google Calendar       |
| T14 | `DELETE /me` (decide approach first)                       | S    | T10         | 1.5  | Cascade verified, no orphans              |
| T15 | AD-4 timezone semantics + test                             | S    | T9          | 1    | Profile tz change leaves events untouched |
| T16 | AD-5 `utc_*` authority + agreement test                    | S    | T1          | 1    | Comments + test in CI                     |
| T17 | `packages/calendar-core` extraction                        | A    | T1          | 2.5  | §7 DoD, ≥90%                              |
| T18 | Mobile on real data                                        | A    | T8, T17     | 2    | §P3 DoD                                   |
| T19 | Onboarding + settings + friend code UI                     | A    | T8, T10–T12 | 4    | §P4 DoD                                   |
| T20 | Web read-only calendar                                     | A    | T17, T8     | 4    | §P5 DoD                                   |
| T21 | Edge Function integration harness + suite                  | S    | T1          | 3    | §13                                       |
| T22 | RLS + `SECURITY DEFINER` grant audit tests                 | S    | T21         | 1.5  | Both green in CI                          |
| T23 | App test runners + Playwright journey                      | A    | T7          | 2    | Both apps have `test`                     |
| T24 | Mobile Sentry/PostHog config plugins                       | A    | T7          | 1    | Crash-free sessions reported              |
| T25 | EAS build setup (iOS + Android)                            | A    | T3          | 2    | Installable on both phones                |
| T26 | APNs + FCM credentials                                     | both | T3, T25     | 1    | Test push received                        |
| T27 | Enable `pg_cron` + live scheduler verification             | S    | T2, T11     | 1.5  | §9 DoD                                    |
| T28 | Web event management                                       | A    | T20         | 3    | Full parity                               |
| T29 | Offline read-only                                          | A    | T8, T18     | 2.5  | Opens with no network                     |
| T30 | Backup cadence + **tested restore**                        | S    | T2          | 1.5  | Dated restore record                      |
| T31 | Bug bash, device matrix, tester onboarding                 | both | T25–T29     | 8    | §P11 DoD                                  |
| T32 | Generated Supabase database types                          | S    | T2          | 1    | No `as unknown as` casts in any function  |

**Totals:** Scott ≈ 22 d · Arlo ≈ 30 d, plus ~8 shared days of M4 testing. Against ~40 available dev-days each across eight weeks _before_ the 20–30% reserve, that is tight but feasible — **only with the M3 descopes held** (web read-only in M3; T28/T29 in M4).

### Critical path

`T1 → T2 → T6 → T7 → T8 → T18/T19/T20 → T28 → freeze → T31 → gate`

T3 (Apple) runs beside everything and gates T25/T26. If it slips, M4 slips regardless of code progress.

---

## 13. Test plan by layer

| Layer                     | Tool                                         | Bar                                                            |
| ------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `recurrence`              | `node:test` + coverage flags                 | 90 lines / 85 branches / 90 funcs — **enforced**               |
| `calendar-core`           | Vitest                                       | ≥90%, thresholds set at creation                               |
| `api-client`              | Vitest + mocked fetch                        | ≥70%; refresh-on-401 and error mapping explicitly covered      |
| Edge Functions            | **new** integration suite vs `pnpm db:start` | Every route's happy path + its 4xx paths                       |
| RLS                       | SQL assertions in the same suite             | Per table: A cannot read B                                     |
| `SECURITY DEFINER` grants | SQL assertion                                | No such function executable by `public`/`anon`/`authenticated` |
| Web                       | Vitest + Testing Library                     | Component-level                                                |
| E2E                       | Playwright (web)                             | Sign up → recurring event → override one → see it              |

**The integration suite is the highest-value item in M3.** Every critical Month 2 finding — the partial-index `ON CONFLICT`, the once-only notification, the broken pagination — would have been caught by a single test that actually invoked the endpoint. Build it early (T21), not last.

---

## 14. Open questions — ✅ all resolved 2026-09-02

| #   | Question                 | Decision                                                                                                                                                                                                                                                                            |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **AD-3**                 | **Confirmed as written** — shared logic in `calendar-core`, separate per-platform views. Not `react-native-web`. T17/T20 unblocked                                                                                                                                                  |
| 2   | **`DELETE /me`**         | **`SECURITY DEFINER` RPC, hard delete.** Guarded by `auth.uid() = p_user_id` inside, with `revoke execute from public, anon, authenticated` in the same migration (§15). `public.users` cascades; returns `202`. No service-role key in a user-facing function. T14 unblocked       |
| 3   | **`isVariableSchedule`** | **Add to the contract.** `is_variable_schedule` is already a real `not null default false` column on `events`, the endpoint emits it and mobile consumes it — so this documents shipped behaviour. P10 exercises variable schedules, so it is load-bearing this phase. T9 unblocked |
| 4   | **Android floor**        | **No plan change.** `apps/mobile` pins `expo ^53.0.0` / `react-native ^0.79.0`; the SDK 53 floor is Android 7.0 (API 24) and iOS 15.1, so Android 8 (API 26) and iOS 16 both clear it. The §P11 matrix stands as written                                                            |
| 5   | **Device sourcing**      | **Hybrid.** Both devs' own phones carry the dogfood window and the push-on-hardware gate (#3, #4) — those need devices in hand. Remaining matrix breadth runs on a cloud farm (Firebase Test Lab / BrowserStack). No procurement lead time                                          |

---

## 15. Standing rules for this phase

- Recurrence is implemented once (AD-1). Anything else consumes the mirror.
- Every `SECURITY DEFINER` function ships with `revoke execute from public, anon, authenticated` **in the same migration**.
- Every new endpoint lands with an integration test in the same PR.
- Every new shared package sets coverage thresholds when it is created, not later.
- A contract change is a two-dev decision, and the regenerated types are committed with it.
- No component imports `supabase-js` or calls `fetch` — enforced by lint, not by convention.
