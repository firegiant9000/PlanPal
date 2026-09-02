# PlanPal — Month 3 Execution Plan (Weeks 9–12)

**Derived from:** [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — _Month 3: Auth, API surface, and the client foundation_
**Team:** Arlo (frontend) · Scott (backend)
**Month goal:** Connect the apps to the backend for the first time — auth, a typed client, and the screens that depend on them — while clearing the Month 1 environment debt.

> **Why phased this way:** Month 3 has one strictly serial chain — **environments → auth → API client → every screen**. Nothing in Phases 3–6 can start until Phase 2 lands, and Phase 2 cannot start until Phase 1 does. The Month 2 branch is what happens when UI and backend are built in parallel against stubs and never meet: a green CI, and five critical defects in code that had never been executed. Phase 0 exists to stop that repeating.

---

## Critical-path summary

```
Phase 0 (Prereqs) ──► Phase 1 (Auth) ──► Phase 2 (API client) ──┬──► Phase 3 (Mobile wiring)
       │                                                        ├──► Phase 4 (Onboarding + settings)
       │                                                        └──► Phase 5 (Web read-only parity)
       │
       └──► Phase 6 (Backend correctness: timezone + utc_start)  [parallel, Scott]
       └──► Phase 7 (Test infrastructure)                        [parallel, both]
```

- **Phase 0 must finish in week 9.** It is Month 1 carry-over and it blocks everything.
- **Start Apple Developer enrolment on day 1 of week 9.** Verification takes up to two weeks and it gates three separate deliverables across M3 and M4.

---

## Phase 0 — Prerequisites & Month 1 carry-over (Week 9) ⚠️ BLOCKS EVERYTHING

_Goal: make it possible to run the product at all. None of this is feature work; all of it is overdue._

### Both

- [ ] **Restore repository access.** `git push`/`fetch` to `firegiant9000/PlanPal` returns _Repository not found_ and CI has therefore never run on a real PR. Nothing below is reviewable until this is fixed.
- [ ] Merge the Month 2 branch once `pnpm db:reset` proves the migration chain applies from scratch (it now includes two review migrations that have never been applied anywhere).

### Scott (backend)

- [ ] **Provision three Supabase projects** — dev / staging / prod. Do _not_ share one across environments.
- [ ] Stand up the secrets store; document the rotation policy. Needed keys: Supabase service-role (×3), Google OAuth, Apple (team/key/services id), `CRON_SECRET`, Expo access token, Sentry DSN, PostHog key.
- [ ] Apply all migrations to dev + staging.
- [ ] **Both-dev sign-off on the `events`/recurrence schema.** This was a Month 1 exit criterion and is still open; the schema has since gained two migrations.
- [ ] Deploy the three Edge Functions to dev; verify `deno lint`/`deno check` pass in CI on a real PR.

### Arlo (frontend)

- [ ] Make `deploy-staging.yml` real, or delete it. It currently `exit 0`s every step on a missing secret and reports green.
- [ ] ⊕ **Start Apple Developer Program enrolment** ($99/yr). Gates Apple Sign-In (Phase 1), APNs push keys (M4) and TestFlight distribution to the ten M4 testers.

**Exit:** three environments live · secrets stored + documented · migrations applied to dev + staging · schema signed off · M2 merged · CI green on a real PR · Apple enrolment submitted.

---

## Phase 1 — Auth (Weeks 9–10) ⭐ CRITICAL PATH — _Month 2 debt_

_Goal: a user can create an account and hold a session. This was M2 week-7 work and was never started._

### Scott (backend) — lead

- [ ] Enable Supabase Auth providers: **email/password**, **Google**, **Apple**.
- [ ] Apple Sign-In: Services ID, key, and return URLs. **Required for App Store approval** — not optional, and not deferrable past MVP.
- [ ] Google: OAuth client + consent screen. Full _verification_ is an M9 item; the dev client is needed now.
- [ ] Verify `handle_new_user()` end-to-end against real signups. It already synthesises a username (`user_<uid12>`), creates `notification_preferences`, and issues a friend code — so onboarding can collect the real username later without hitting the NOT NULL constraint.
- [ ] Confirm the trigger is idempotent and that a failed signup does not leave orphaned `auth.users` rows.

### Arlo (frontend)

- [ ] Sign-up / sign-in / forgot-password screens on both platforms.
- [ ] Session persistence + silent refresh; deep-link OAuth callback handling for `expo-router`.
- [ ] Route guarding: unauthenticated users never reach a calendar screen.

**Exit:** all three providers work on web _and_ a real device · sessions survive app restart · a new signup produces a complete `users` + `notification_preferences` + `friend_codes` row set.

---

## Phase 2 — Client API layer (Weeks 10–11) ⭐ CRITICAL PATH

_Goal: one typed, tested way for either app to talk to the backend. The plan never listed this and everything else waits on it._

### Arlo (frontend)

- [ ] Create **`packages/api-client`**:
  - Typed surface over `packages/types/src/generated` (already contract-generated and drift-gated).
  - Auth token injection + refresh, sharing the Supabase Auth session.
  - Normalise the `ApiResult` envelope — the Edge Functions return `{ok:true,data}` / `{ok:false,error:{code,message}}`. **Pick one convention** (thrown errors _or_ result objects) and apply it everywhere.
  - A cache seam, so the M4 offline work is not a retrofit.
- [ ] Enforce the house rule: no component calls `fetch` or `supabase-js` directly. Add a lint rule if that is cheap.

**Exit:** both apps read `GET /occurrences` through the client against a real dev project · error envelope normalised · token refresh proven by an expired-session test.

---

## Phase 3 — Mobile on real data (Week 11)

_Goal: delete the stubs._

### Arlo (frontend)

- [ ] Replace `STUB_EVENTS` in the mobile home screen with `GET /occurrences`.
- [ ] Wire the create-event form to `POST /events`; wire occurrence edit/cancel to the `PUT`/`DELETE` occurrence routes.
- [ ] Register the device: `POST /me/devices` on launch with the Expo push token.
- [ ] Sensitive-public rendering: grey "Busy" blocks showing time and duration only, in the owner's own view. The `busyBlock` token already exists. _(Server-side redaction is M7 and must land before any shared view reaches a tester.)_

**Exit:** create → see on calendar → edit one occurrence → cancel one occurrence, all against dev, on a device.

---

## Phase 4 — Profiles, onboarding & settings (Weeks 11–12)

### Scott (backend)

- [ ] `/healthz`.
- [ ] `/me` — GET, PATCH, DELETE. DELETE is the GDPR path; it must cascade and is not trivial.
- [ ] `/me/notification-preferences` — GET, PUT.
- [ ] `/me/devices` + `/me/devices/{expoPushToken}`. **Push cannot work at all without this** — the scheduler reads `devices` and nothing currently writes to it.
- [ ] `/friend-code` + `/friend-code/rotate`. Rotation stamps the old code's 30-day expiry; the partial unique index enforces one active code per user.
- [ ] `/export/ical` — minimum viable version. Returns `text/calendar`, **not** the JSON envelope, so the shared `ok()` helper does not fit; add a raw-response path. The standards-compliant version (EXDATE, override VEVENTs) is M9.

### Arlo (frontend)

- [ ] Onboarding: username, display name, birthday, default visibility, timezone (auto-detect + override).
- [ ] Avatar upload with circle crop. **The object path must start with the user's id** — `avatars/<user_id>/avatar.png` — or the storage RLS policy rejects it with a policy violation rather than a useful message.
- [ ] Settings: notification defaults, default visibility, timezone management, account settings, data export (iCal).
- [ ] Friend code UI: 8-char code as QR + native share sheet.
- [ ] ⊕ **Empty / error / loading states** as explicit work: no-events, failed load, offline indicator, permission denied.

> **Note:** setting a birthday fires `sync_birthday_event()`, which marks its master row with `color_label = '__birthday__'` — a sentinel in a user-facing colour column. Replace with a real boolean column before it surfaces in a colour picker.

**Exit:** a new user completes onboarding, sets preferences, sees their friend code, and exports an `.ics` that imports into Google Calendar.

---

## Phase 5 — Web read-only parity (Weeks 10–12)

\*Goal: web becomes a usable dev/test environment. **Event management on web is deliberately M4.\***

### Arlo (frontend)

- [ ] **Extract `packages/calendar-core` first.** Layout maths, overlap-column packing and holiday computation currently live inside `EventBar`, `DayTimeSheet` and `calendarUtils`. That logic must not fork across platforms; the markup can.
- [ ] Web views against `calendar-core`: month grid, week strip, 24h time-sheet, event detail.
- [ ] Desktop interactions the phone version has no concept of: hover states, keyboard navigation, focus order.

> **Decision recorded:** shared logic + separate views, rather than `react-native-web`. RNW would need `transpilePackages` and aliasing, has SSR pitfalls, ships a large bundle, and a `PanResponder` swipe-up sheet is not a desktop interaction. This also matches the pattern the repo already chose for `Button`/`Text`.

**Exit:** web renders the signed-in user's real calendar in all three views, with no RN dependency in the Next.js bundle.

---

## Phase 6 — Backend correctness (Weeks 11–12, parallel)

_Goal: close two known-wrong behaviours before they reach testers._

### Scott (backend)

- [ ] **Timezone semantics + contract fix.** `openapi.yaml` states that `PATCH /me` with a new `timezoneId` recomputes `utcStart`/`utcEnd` for _all_ the user's events. Implemented literally that moves the user's entire calendar — a 9am New York meeting must stay 9am New York after they fly to London. Correct model:
  - Profile timezone = default for _new_ events + display timezone. It never rewrites stored events.
  - Changing an _individual event's_ `timezone_id` does recompute — and already does, via the `events_derive_utc` trigger on update.
  - The only genuine bulk case is a tzdata change (a country alters DST rules), which is a maintenance job.
  - **Amend the contract description before anyone builds to it.**
- [ ] **Close the `utc_start` divergence.** `events_derive_utc()` uses Postgres `AT TIME ZONE`; `packages/recurrence` applies an explicit gap/fold policy and ignores the stored value. The two can disagree by an hour, twice a year. _Recommended:_ treat `utc_*` as an index approximation only, never user-visible — document it in the column comment, keep all responses deriving from the engine, and add a test asserting agreement outside gap/fold hours.
- [ ] Resolve the **`isVariableSchedule` contract drift** — `GET /occurrences` returns it, `EventOccurrence` does not define it, and the mobile calendar consumes it. Add it to the spec and regenerate, or drop it. Needs both-dev sign-off either way.

**Exit:** contract matches implemented behaviour · timezone semantics documented and tested · `utc_*` authority recorded in the schema.

---

## Phase 7 — Test infrastructure (Weeks 10–12, parallel) ⊕

_Goal: make the M2 class of defect impossible to ship again._

### Scott (backend)

- [ ] **Edge Function integration tests** against the local Supabase stack (`pnpm db:start`). Every critical M2 finding would have been caught by one test that actually called the endpoint. Highest-value item in the month.
  - Minimum set: create master → expand occurrences → override one → cancel one → list with pagination → reject a bad RRULE.
- [ ] **RLS regression tests**: assert per table that user A cannot read user B's rows.
- [ ] **A `SECURITY DEFINER` grant audit test** — fail if any such function is executable by `public`, `anon` or `authenticated`.

### Arlo (frontend)

- [ ] Add `test` scripts to `apps/web` and `apps/mobile` — neither has one today. Vitest + Testing Library (web), React Native Testing Library (mobile).
- [ ] Playwright E2E on the critical journey: sign up → create recurring event → edit one occurrence → see it on the calendar.
- [ ] ⊕ **Wire mobile Sentry/PostHog config plugins.** Deferred since M1; crash-free sessions is an MVP baseline KPI that currently cannot be measured on the platform that matters most.

**Exit:** both apps have a runner · Edge Functions have runtime tests in CI · RLS + grant audits green.

---

## Dependencies & sequencing (at a glance)

| Item                                | Blocks                          | Must finish by      |
| ----------------------------------- | ------------------------------- | ------------------- |
| Repo access + M2 merge (Phase 0)    | Everything                      | Week 9, day 2       |
| Supabase environments (Phase 0)     | Auth, all endpoints             | Week 9              |
| Apple Developer enrolment (Phase 0) | Apple Sign-In, APNs, TestFlight | Submitted week 9    |
| Auth (Phase 1)                      | API client, every screen        | Week 10             |
| `packages/api-client` (Phase 2)     | Phases 3, 4, 5                  | Week 11             |
| `packages/calendar-core` (Phase 5)  | Web views                       | Before any web view |
| `/me/devices` (Phase 4)             | M4 push-on-device               | Week 12             |

## Risks (Month 3)

- ⚠️ **The chain is serial.** Auth → client → screens cannot be parallelised. Building UI against stubs while the backend is untested is exactly what produced the M2 defects.
- ⚠️ **Web parity is the most underestimated line in the original plan.** None of the M2 calendar runs in Next.js. Read-only is the descope that makes the month fit; do not quietly re-expand it.
- ⚠️ **Apple enrolment is a hard external dependency** with a two-week tail and three downstream deliverables. If it is not submitted in week 9, M4 slips regardless of engineering progress.
- ⚠️ **Timezone recomputation is subtle** and the contract currently describes behaviour that would corrupt calendars.
- ⚠️ **Recruiting M4's ten testers is lead time, not engineering time.** Start in week 11, especially for people with variable-schedule jobs.

## Month 3 exit checklist

- [ ] Three Supabase environments + secrets store live; migrations applied; schema signed off.
- [ ] Auth works on web and a real device for all three providers.
- [ ] `packages/api-client` is the only path to the backend from either app.
- [ ] Mobile runs on real data end-to-end: create, edit one occurrence, cancel one occurrence.
- [ ] Onboarding + settings complete; `.ics` export imports cleanly elsewhere.
- [ ] Web renders the real calendar read-only in all three views.
- [ ] Contract matches implementation; timezone + `utc_*` semantics documented.
- [ ] Edge Function integration tests, RLS regression tests and app test runners in CI.
- [ ] Apple Developer membership active; ten M4 testers identified.

> **Capacity note:** Reserve **20–30%** of the month for non-feature work (DevOps, reviews, support) — it is _not_ included in the estimates above. This month is already the tightest in Phase 1; if something has to give, take it from Phase 5 (web) before Phase 7 (tests).
