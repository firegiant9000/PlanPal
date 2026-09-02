# PlanPal — Months 3–4 Execution Plan (Weeks 9–16)

**Derived from:** [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — _Phase 1 completion_
**Companion:** [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the engineering detail behind every task here
**Team:** Arlo (frontend) · Scott (backend)
**Outcome:** the MVP exit gate cleared — a working app both devs use daily, in the hands of ten real testers.

> **Why the two months are one document.** M3 and M4 are not independent. M3 is over-subscribed, so two of its features are _planned_ to land in M4's first fortnight; M4's dogfooding window is only reachable if M3 ships auth and builds on time. Treating them separately is what let the M2 auth slip go unnoticed until it had already cost a month. One document, one critical path, one gate.

---

## The shape of the next eight weeks

```
wk 9        wk 10        wk 11        wk 12   │  wk 13        wk 14        wk 15        wk 16
────────────────────────────────────────────  │  ──────────────────────────────────────────────
P0 Prereqs                                    │  P8 Builds+push
   └─► P1 Auth                                │  P9 Spillover ──┐
          └─► P2 API client                   │                 ├─► FREEZE ─► P10 Dogfood ──┐
                 ├─► P3 Mobile on real data   │                 │            P11 Bug bash ──┼─► P12
                 ├─► P4 Profiles & settings   │                 │            P11 Devices ───┤   Gate
                 └─► P5 Web read-only         │                 │            P11 Testers ───┘
   P6 Backend correctness    (parallel)       │  P12 Backup & DR
   P7 Test infrastructure    (parallel)       │
```

**Three dates that are not negotiable:**

| By end of | What                                    | Why                                                                                                                  |
| --------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **wk 9**  | Apple Developer enrolment submitted     | ~2-week verification tail, and it gates Apple Sign-In, APNs push keys _and_ TestFlight — three separate deliverables |
| **wk 13** | Installable builds on both devs' phones | 2 weeks of dogfooding is a gate criterion; a wk-15 build makes it arithmetically impossible                          |
| **wk 14** | Feature freeze                          | Everything after is bug-fixing. The stabilisation window exists to protect the gate                                  |

**The serial chain:** environments → auth → API client → every screen. It cannot be parallelised. Building UI against stubs while the backend goes unexercised is exactly what produced the Month 2 defects — five criticals in code that had never been executed, behind a green CI.

---

# MONTH 3 (Weeks 9–12) — Connect the apps to the backend

---

## P0 — Prerequisites & Month 1 carry-over (wk 9) ⚠️ BLOCKS EVERYTHING

_None of this is feature work. All of it is overdue, and all of it blocks._

### Both

- [x] Restore repository access. _(Done — PR #2 open, CI running for the first time.)_
- [ ] Merge the Month 2 branch once `pnpm db:reset` proves the migration chain applies from scratch. It now carries two review migrations that have never been applied to any database.

### Scott

- [ ] **Provision three Supabase projects** — dev / staging / prod. Do not share one across environments.
- [ ] Stand up the secrets store; document rotation. Keys needed: Supabase service-role (×3), Google OAuth, Apple (team ID / key / Services ID), `CRON_SECRET`, Expo access token, Sentry DSN, PostHog key.
- [ ] Apply all migrations to dev + staging.
- [ ] **Both-dev sign-off on the `events`/recurrence schema** — a Month 1 exit criterion still open, and the schema has since gained two migrations.
- [ ] Deploy the three Edge Functions to dev.

### Arlo

- [ ] Make `deploy-staging.yml` real or delete it. It `exit 0`s every step on a missing secret and reports green.
- [ ] ⊕ **Submit Apple Developer Program enrolment** ($99/yr). See the non-negotiable dates above.

**Exit:** three environments live · secrets stored and documented · migrations applied to dev + staging · schema signed off · M2 merged · CI green on a real PR · Apple enrolment submitted.

---

## P1 — Auth (wk 9–10) ⭐ CRITICAL PATH — _Month 2 debt_

_A user can create an account and hold a session. This was M2 week-7 work and was never started._

### Scott

- [ ] Enable Supabase Auth providers: email/password, Google, Apple.
- [ ] Apple Sign-In: Services ID, key, return URLs. **Required for App Store approval** — not deferrable past MVP.
- [ ] Google OAuth client + consent screen. Full _verification_ is M9; the dev client is needed now.
- [ ] Verify `handle_new_user()` against real signups. It already synthesises a username (`user_<uid12>`), creates `notification_preferences` and issues a friend code — so onboarding can collect the real username later without hitting the NOT NULL constraint.
- [ ] Confirm a failed signup leaves no orphaned `auth.users` row.

### Arlo

- [ ] Sign-up / sign-in / forgot-password on both platforms.
- [ ] Session persistence + silent refresh; deep-link OAuth callback for `expo-router`.
- [ ] Route guarding — an unauthenticated user never reaches a calendar screen.

**Exit:** all three providers work on web _and_ a real device · sessions survive app restart · a new signup produces a complete `users` + `notification_preferences` + `friend_codes` row set.

---

## P2 — Client API layer (wk 10–11) ⭐ CRITICAL PATH

_One typed, tested way for either app to reach the backend. The original plan never listed this, and everything else waits on it._

### Arlo

- [ ] Create **`packages/api-client`** — typed surface over the generated contract types, auth token injection and refresh, a single normalised error model, and a cache seam so M4's offline work is not a retrofit.
- [ ] Enforce the house rule: no component calls `fetch` or `supabase-js` directly. Add a lint rule if cheap.

**Exit:** both apps read `GET /occurrences` through the client against dev · error envelope normalised · token refresh proven by an expired-session test.

---

## P3 — Mobile on real data (wk 11)

### Arlo

- [ ] Delete `STUB_EVENTS`; wire the home screen to `GET /occurrences`.
- [ ] Wire the create-event form to `POST /events`; wire occurrence edit/cancel to the `PUT`/`DELETE` occurrence routes.
- [ ] Register the device against `POST /me/devices` on launch with the Expo push token.
- [ ] Sensitive-public rendering: grey "Busy" blocks, time and duration only, in the owner's own view. The `busyBlock` token exists. _(Server-side redaction is M7 and must land before any shared view reaches a tester.)_

**Exit:** create → see on calendar → edit one occurrence → cancel one occurrence, against dev, on a device.

---

## P4 — Profiles, onboarding & settings (wk 11–12)

### Scott — the remaining M3 API surface

- [ ] `/healthz`
- [ ] `/me` — GET, PATCH, DELETE (the GDPR path; it must cascade and is not trivial)
- [ ] `/me/notification-preferences` — GET, PUT
- [ ] `/me/devices` + `/me/devices/{expoPushToken}` — **push cannot work at all without this.** The scheduler reads `devices` and nothing currently writes to it
- [ ] `/friend-code` + `/friend-code/rotate`
- [ ] `/export/ical` — minimum viable. Returns `text/calendar`, not the JSON envelope, so the shared `ok()` helper does not fit

### Arlo

- [ ] Onboarding: username, display name, birthday, default visibility, timezone (auto-detect + override).
- [ ] Avatar upload with circle crop. **The object path must start with the user's id** — `avatars/<user_id>/avatar.png` — or storage RLS rejects it with a policy violation rather than a useful message.
- [ ] Settings: notification defaults, default visibility, timezone management, account settings, iCal export.
- [ ] Friend code UI: 8-char code as QR + native share sheet.
- [ ] ⊕ **Empty / error / loading states** as explicit work: no-events, failed load, offline, permission denied.

> Setting a birthday fires `sync_birthday_event()`, which marks its master row with `color_label = '__birthday__'` — a sentinel in a user-facing colour column. Replace with a real boolean before it reaches a colour picker.

**Exit:** a new user completes onboarding, sets preferences, sees their friend code, and exports an `.ics` that imports into Google Calendar.

---

## P5 — Web read-only parity (wk 10–12)

\*Web becomes a usable dev/test environment. **Event management on web is deliberately M4.\***

### Arlo

- [ ] **Extract `packages/calendar-core` first.** Layout maths, overlap-column packing and holiday computation currently sit inside `EventBar`, `DayTimeSheet` and `calendarUtils`. That logic must not fork across platforms; markup may.
- [ ] Web views against `calendar-core`: month grid, week strip, 24h time-sheet, event detail.
- [ ] Desktop interactions the phone has no concept of: hover, keyboard navigation, focus order.

> **Decision:** shared logic + separate views, not `react-native-web`. RNW needs `transpilePackages` and aliasing, has SSR pitfalls, ships a large bundle, and a `PanResponder` swipe-up sheet is not a desktop interaction. This also matches the pattern the repo already chose for `Button`/`Text`.

**Exit:** web renders the signed-in user's real calendar in all three views, with no React Native dependency in the Next.js bundle.

---

## P6 — Backend correctness (wk 11–12, parallel)

_Two known-wrong behaviours, closed before they reach testers._

### Scott

- [ ] **Timezone semantics + contract fix.** `openapi.yaml` says `PATCH /me` with a new `timezoneId` recomputes `utcStart`/`utcEnd` for _all_ the user's events. Implemented literally, that moves the user's entire calendar — a 9am New York meeting must stay 9am New York after they fly to London. Correct model: profile timezone is the default for _new_ events and the display timezone, and never rewrites stored events; changing an _individual event's_ `timezone_id` does recompute, and already does via the trigger; the only genuine bulk case is a tzdata change, which is a maintenance job. **Amend the contract before anyone builds to it.**
- [ ] **Close the `utc_start` divergence.** `events_derive_utc()` uses Postgres `AT TIME ZONE`; `packages/recurrence` applies an explicit gap/fold policy and ignores the stored value. They can disagree by an hour, twice a year. Recommended: treat `utc_*` as an index approximation, never user-visible — document it in the column comment, keep every response deriving from the engine, and add a test asserting agreement outside gap/fold hours.
- [ ] Resolve the **`isVariableSchedule` contract drift** — the endpoint returns it, `EventOccurrence` does not define it, the mobile calendar consumes it. Add it to the spec or drop it. Needs both-dev sign-off either way.

**Exit:** contract matches implemented behaviour · timezone semantics documented and tested · `utc_*` authority recorded in the schema.

---

## P7 — Test infrastructure (wk 10–12, parallel) ⊕

_Make the Month 2 class of defect impossible to ship again._

### Scott

- [ ] **Edge Function integration tests** against the local stack (`pnpm db:start`). Every critical M2 finding would have been caught by one test that actually called the endpoint. Highest-value item in the month. Minimum set: create master → expand → override one → cancel one → paginate → reject a bad RRULE.
- [ ] **RLS regression tests** — per table, assert user A cannot read user B's rows.
- [ ] **A `SECURITY DEFINER` grant audit test** — fail if any such function is executable by `public`, `anon` or `authenticated`. This is the exact hole found in M2.

### Arlo

- [ ] Add `test` scripts to `apps/web` and `apps/mobile`. Neither has one today.
- [ ] Playwright E2E on the critical journey: sign up → create recurring event → edit one occurrence → see it on the calendar.
- [ ] ⊕ Wire the mobile Sentry/PostHog config plugins. Deferred since M1; crash-free sessions is an MVP baseline KPI that currently cannot be measured on the platform that matters most.

**Exit:** both apps have a runner · Edge Functions have runtime tests in CI · RLS and grant audits green.

---

## Month 3 exit checklist

- [ ] Three Supabase environments + secrets store; migrations applied; schema signed off.
- [ ] Auth works on web and a real device for all three providers.
- [ ] `packages/api-client` is the only path to the backend from either app.
- [ ] Mobile on real data end-to-end: create, edit one occurrence, cancel one occurrence.
- [ ] Onboarding + settings complete; `.ics` export imports cleanly elsewhere.
- [ ] Web renders the real calendar read-only in all three views.
- [ ] Contract matches implementation; timezone and `utc_*` semantics documented.
- [ ] Edge Function integration tests, RLS regression tests, app test runners in CI.
- [ ] Apple Developer membership active; ten M4 testers identified.

---

# MONTH 4 (Weeks 13–16) — Spillover, then stabilisation

---

## P8 — Real builds & push on hardware (wk 13) ⚠️ GATES DOGFOODING

### Both

- [ ] **EAS Build** for iOS and Android development builds. Push no longer works in Expo Go on Android (SDK 53+), so a dev build is mandatory — and it is the same mechanism TestFlight distribution needs.
- [ ] **APNs key** from the Apple Developer account. If M3 enrolment slipped, this is where the whole month blocks.
- [ ] **FCM credentials** + `google-services.json`.

### Scott

- [ ] **Enable the `pg_cron` schedule.** It is committed but commented out in `20260614000002`, so the scheduler has never fired. Needs `pg_net`, the function URL, and `CRON_SECRET` in the vault.
- [ ] Verify end-to-end against real preference rows: multiple lead times, quiet hours across an overnight window, and a recurring series firing on more than one occurrence.
- [ ] Confirm dead-token pruning — send to a deregistered device, check the `devices` row is removed.

**Exit:** both devs have PlanPal on their own phone · a reminder for a _recurring_ event arrives on iOS and Android · quiet hours suppress correctly.

---

## P9 — Month 3 spillover (wk 13–14)

_The two items deliberately moved out of M3. Nothing else is added._

### Arlo

- [ ] **Event management on web** — create, edit, delete, occurrence override and cancel, against `calendar-core` and `api-client`. Web then reaches full parity and becomes the primary dev/test environment as intended.
- [ ] **Offline read-only** — cache the last-loaded calendar, clear offline indicator, edits blocked with an explanatory state rather than a failure. Cache **by month**, not by arbitrary `(from,to)` window, or it never hits twice. Full offline _editing_ stays Post-V1.

**Exit (end of wk 14):** web at parity · the app opens and shows the last-known calendar with no network · **feature freeze begins.**

---

## P10 — Dogfooding (wk 14–16)

_Two consecutive weeks of both devs using PlanPal as their primary calendar. A gate criterion, not a nice-to-have._

### Both

- [ ] Migrate real personal schedules in; use as primary calendar for **≥2 consecutive weeks**.
- [ ] Keep a shared log of every friction point, not just crashes — confusion is the signal that matters before external testers arrive.
- [ ] At least one dev runs a variable-schedule routine and lives with the placeholder behaviour.
- [ ] Cross-timezone check: one dev changes device timezone for a day and confirms nothing shifts.

**Exit:** 14 consecutive days of daily use by both devs, logged.

---

## P11 — Bug bash, device matrix, external testers (wk 14–16)

### Internal bug bash

- [ ] **Recurrence edge cases** — the project's #1 risk. Explicitly: spring-forward gap, fall-back fold, leap day, week rollover across a year boundary, `COUNT` vs `UNTIL`, bi-weekly with a mid-week start, single-occurrence edit then cancel, and an override that changes the timezone.
- [ ] **Notification delivery** on real iOS and Android, with battery saver / Doze active and the app force-quit.
- [ ] **Visibility enforcement** for the owner's own view. _Cross-user leakage cannot be tested until the friend graph lands in M6 — record that as a known limit of this gate._
- [ ] Event CRUD stability under repeated edit/cancel/restore cycles.

### Device matrix

- [ ] Android 8 / 10 / 12 / 14 and iOS 16 / 17 / 18 — **physical devices, not simulators.** Seven devices is procurement lead time; start sourcing in M3. A cloud farm (Firebase Test Lab, BrowserStack) runs real hardware and satisfies this at a fraction of the cost.
- [ ] **Confirm Android 8 (API 26) is still above the Expo SDK floor in use.** If not, the matrix changes and the plan's target OS range needs revising.

### External testers

- [ ] **Ten real users**, weighted toward variable-schedule jobs. Identified in M3, onboarded here.
- [ ] iOS via **TestFlight**; Android via internal testing track or direct APK.
- [ ] **Observe unaided.** Do not explain the UI. Document every confusion point verbatim.
- [ ] Fix all critical + high. Mediums go on a written known-issues list carried into Beta.

**Exit:** matrix complete · 10 users onboarded and observed · critical/high queue empty.

---

## P12 — Reliability & the gate (wk 16)

### Scott ⊕

- [ ] **Backup & disaster recovery**, required before external users and scheduled nowhere else: backup cadence configured and documented, **a restore actually performed and verified** (an untested backup is not a backup), and the RLS regression tests from P7 running in CI.
- [ ] Confirm `notification_sends` retention pruning runs and the table is not growing unbounded.

### Both

- [ ] Walk the gate item by item and record evidence for each — not a self-assessment.

---

## MVP exit gate

| #   | Criterion                         | Evidence required                                                                             |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Event CRUD stable                 | Integration tests green + no open critical/high CRUD bugs                                     |
| 2   | Recurrence passes edge-case tests | Engine suite green at ≥90% coverage **and** the P11 manual DST/leap/rollover checklist signed |
| 3   | Push works on real devices        | A _recurring_-event reminder received on physical iOS **and** Android, app backgrounded       |
| 4   | Both devs used it daily ≥2 weeks  | 14-day dogfood log                                                                            |
| 5   | 10 real users tested              | Session notes per user                                                                        |
| 6   | All critical + high bugs fixed    | Empty queue; mediums on a written known-issues list                                           |
| 7   | Backups restorable                | A completed test restore, dated                                                               |

**Do not start Beta until all seven are evidenced.**

---

## Dependencies at a glance

| Item                           | Blocks                          | Due                     |
| ------------------------------ | ------------------------------- | ----------------------- |
| M2 merge + environments (P0)   | Everything                      | wk 9                    |
| Apple Developer enrolment (P0) | Apple Sign-In, APNs, TestFlight | submitted wk 9          |
| Auth (P1)                      | API client, every screen        | wk 10                   |
| `packages/api-client` (P2)     | P3, P4, P5                      | wk 11                   |
| `packages/calendar-core` (P5)  | Web views, M4 web management    | before any web view     |
| `/me/devices` (P4)             | Push on device (P8)             | wk 12                   |
| EAS builds + cron (P8)         | Dogfooding, testers, gate #3    | wk 13                   |
| Dogfood start (P10)            | Gate #4                         | **wk 14 at the latest** |

## Risks

- ⚠️ **The chain is serial.** Auth → client → screens cannot be parallelised. Building UI against stubs while the backend goes unexercised is what produced the M2 defects.
- ⚠️ **Web parity is the most underestimated line in the original plan.** None of the M2 calendar runs in Next.js. Read-only in M3 is the descope that makes the month fit — do not quietly re-expand it.
- ⚠️ **Apple is a single point of failure** for three gate-relevant deliverables, with a two-week tail. Not submitted in wk 9 means M4 slips regardless of engineering progress.
- ⚠️ **Dogfooding is arithmetically fragile.** Two consecutive weeks inside a four-week month means builds by wk 13 and dogfooding started by wk 14. A one-week slip in P8 makes gate #4 unreachable without extending the month.
- ⚠️ **Push delivery varies wildly** by device, OS and power-saving mode. Simulators prove nothing; budget real time for Doze on Android.
- ⚠️ **Visibility enforcement cannot be fully validated** before M6. Record it so the Beta privacy QA pass does not assume it was covered here.
- ⚠️ **Spillover creep.** Weeks 13–14 are for two named items. Anything else that "just needs finishing" eats the stabilisation window that protects the gate.
- ⚠️ **Recruiting testers is lead time, not engineering time.** Start in wk 11, especially for people with variable-schedule jobs.

> **Capacity note:** reserve **20–30%** of both months for non-feature work — it is _not_ in the estimates above. M3 is the tightest month in Phase 1; if something must give, take it from P5 (web) before P7 (tests). In M4 that reserve is usually _under_-estimated: triage, tester support and device wrangling are the month's real workload.
