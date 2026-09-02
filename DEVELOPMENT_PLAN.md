# PlanPal — Month-by-Month Development Plan

**Team:** Arlo (frontend) + Scott (backend) · **Target:** V1 public launch in 12 months
**Source:** PlanPal Product Development Roadmap (MVP / Beta / V1 / Post-V1)
**Capacity assumption:** 30–50 combined hrs/week. Reserve **20–30%** of every month for non-feature work (app store, DevOps, support, reviews) — it is _not_ in the task estimates below.
**Last revised:** 2026-09-01 (post-M2 code review). See [What changed in this revision](#what-changed-in-this-revision).

> **Week→Month mapping** (4 weeks ≈ 1 month):
> M1=wk 1–4 · M2=wk 5–8 · M3=wk 9–12 · M4=wk 13–16 · M5=wk 17–20 · M6=wk 21–24 · M7=wk 25–28 · M8=wk 29–32 · M9=wk 33–36 · M10=wk 37–40 · M11=wk 41–44 · M12=wk 45–48.

---

## Where we actually are

| Month                                  | Plan status         | Reality                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** Foundations                     | ✅ Merged           | Schema, OpenAPI contract, monorepo, CI, recurrence kickoff all landed. **Open:** 3 Supabase environments, secrets store, both-dev schema sign-off, migrations applied to dev/staging.                                                       |
| **M2** Recurrence + notifications + UI | 🟡 Built, in review | Recurrence engine complete; `/events` + `/occurrences` + notification scheduler built; mobile calendar + create-event UI built. **Auth (wk 7) never started.** A code review found and fixed 5 critical defects; see `docs/` and the M2 PR. |
| **M3** Calendar UI + profiles/auth     | ⬜ Not started      | Opens carrying M2's auth debt. **Rescoped** — see below.                                                                                                                                                                                    |
| **M4** Stabilisation                   | ⬜ Not started      | **Rescoped** — absorbs the work moved out of M3.                                                                                                                                                                                            |
| **M5+**                                | ⬜ Not started      | Unchanged.                                                                                                                                                                                                                                  |

**The one number that matters:** nothing in either app is connected to Supabase yet. There is no auth, no API client, and no service layer. Every M3 screen sits behind that chain.

---

## Phase Overview

| Phase                                    | Months | Weeks | Outcome                                             |
| ---------------------------------------- | ------ | ----- | --------------------------------------------------- |
| **MVP** — Core App & Calendar Engine     | 1–4    | 1–16  | Daily-usable app, handed to 10 real testers         |
| **Beta** — AI Import & Social Layer      | 5–8    | 17–32 | 50–200 user closed beta; parsing + social validated |
| **V1** — Integrations & Public Launch    | 9–12   | 33–48 | Public launch (App Store, Play, web)                |
| **Post-V1** — Plugin Foundation & Growth | 13+    | 49+   | Pace TBD; only after 500+ active users for 4+ weeks |

**Hard sequencing gates (do not skip):**

- Don't start **Beta** until MVP is stable _and_ tested by ≥10 real users.
- Don't submit to **app stores** until privacy QA passes with zero leakage + parsing hits target accuracy + closed beta ran ≥4 weeks.
- Don't start **Post-V1** until public for ≥4 weeks with ≥500 active users.

**How cross-cutting work is scheduled.** Previously these lived in a separate section at the end of the document, disconnected from the months they belong to, and most were skipped. They are now **inlined into the month where they start**, marked ⊕. The index at the bottom lists them all.

---

# PHASE 1 — MVP (Months 1–4)

**Goal:** A working app Arlo and Scott use daily, handed to 10 real test users by end of Month 4.
**MVP exit gate:** event CRUD stable · recurrence passes edge-case tests · push works on real devices · both devs used it daily for ≥2 weeks · all critical/high bugs fixed.

---

## Month 1 (Weeks 1–4) — Foundations: Data Model + Calendar Engine kickoff ✅

**Focus:** Get the schema right (it's load-bearing for everything) and lock the API contract before parallel work begins.
**Detail:** [MONTH_1_PLAN.md](MONTH_1_PLAN.md)

### Scott (backend)

- [x] Design & migrate core schema: `events`, `notification_preferences`, `users`, `friend_connections`, `friend_codes` (+`devices`).
  - `events`: master-rule + exceptions model (no pre-generated instances). `is_master`, `master_event_id`, `recurrence_rule` (RRULE), `recurrence_exception_date`, `local_start`/`local_end`, `timezone_id` (IANA), `utc_start`/`utc_end`, `visibility`, `color_label`.
  - Timezone approach: `local_start + timezone_id` is source of truth; derive/store `utc_start`/`utc_end` for indexing & conflict detection.
- [x] **OpenAPI spec** — all endpoint shapes, request bodies, error codes agreed _before_ any API coding.
- [x] Begin recurrence engine: server-side occurrence expansion for a requested date range.
- [ ] ⊕ **Supabase project provisioning**: Postgres, Auth providers, storage buckets, RLS. _Buckets + RLS are written as migrations; the cloud projects are not provisioned._
- [ ] ⊕ **Environments & secrets**: separate dev / staging / prod projects; secrets store; documented rotation policy.

### Arlo (frontend)

- [x] Monorepo setup with shared TypeScript types across mobile / web / API.
- [x] CI/CD: GitHub Actions (lint, type-check, tests on every PR).
- [x] Expo + Next.js app scaffolds wired to the monorepo; shared component library skeleton.
- [x] Review/co-author OpenAPI spec from the consumer side.
- [x] ⊕ **Design system / UX baseline**: shared tokens + component contracts.
- [x] ⊕ **Automated test strategy** documented (`docs/TESTING.md`); ⊕ **KPI baselines** documented (`docs/METRICS.md`).
- [ ] ⊕ **Auto-deploy staging on merge to main** — `deploy-staging.yml` exists but `exit 0`s every real step on a missing secret. Inert.

### Carried into Month 3

Schema sign-off, migrations applied to dev + staging, three Supabase environments, secrets store, working staging deploy. **These gate M3 — clear them in week 9.**

---

## Month 2 (Weeks 5–8) — Recurrence + Notifications + Calendar UI begins 🟡

**Focus:** Finish the calendar engine, ship the notification service, and start the mobile UI.

### Scott (backend)

- [x] Recurrence engine complete: RRULE — weekly, bi-weekly, custom days (M/W/F), end-by-date, end-after-N, repeat-forever, plus MONTHLY/YEARLY, ordinal BYDAY, BYMONTHDAY, BYMONTH, BYSETPOS, WKST. DST, leap years and week-number boundaries covered by 46 tests. Client never expands rules.
- [x] Variable-schedule routine type: flag on master event; no pre-generation; "Schedule not yet entered" placeholder.
- [x] `GET /occurrences` + `/events` CRUD incl. THIS-scope override and cancel.
- [x] Push notification scheduler: per-minute job → occurrences whose lead times fall in the window → dispatch via Expo Push. Driven by `notification_preferences`.
- [x] Birthday auto-event: yearly RRULE on birthday set/change, Private by default.
- [ ] **Auth flows (wk 7): email/password, Google, Apple Sign-In.** ⚠️ **Not started — moved to Month 3, Workstream A.**

### Arlo (frontend)

- [x] Month view: grid, current-day highlight, US federal holiday labels. _(Static rule-based set, not the planned iCal feed — acceptable; revisit if non-US users appear.)_
- [x] Swipe-up bottom sheet → week strip + vertical 24h time-sheet.
- [x] Time-sheet bars (avatar, title, color), tap → detail, horizontal swipe between days.
- [x] Event creation flow: title, date/time range, repeat settings (incl. variable-schedule toggle), notification prefs, visibility.
- [ ] Friend avatar bubbles on the month grid — stubbed only; real data needs the friend graph (M6).

### Review outcome (2026-09-01)

CI was green throughout because `supabase/functions` is not a pnpm workspace and sat outside every gate. Five critical defects found and fixed: a `SECURITY DEFINER` function readable by any authenticated user (every user's event titles + push tokens), recurring events that would notify exactly once, occurrence override/cancel that could never succeed against a partial unique index, a duplicate untested RRULE walker in the Edge Function, and every occurrence in a series carrying the master's start time. Post-fix: single shared engine with a CI drift gate, a Deno lint/type-check job, and enforced coverage thresholds.

### Risks (still live)

- ⚠️ Recurrence edge cases remain the #1 bug source. The engine is well tested; the _integration_ is not — there are still no Edge Function runtime tests.

---

## Month 3 (Weeks 9–12) — Auth, API surface, and the client foundation ⬅️ RESCOPED

**Focus:** Connect the apps to the backend for the first time. Auth → API client → service layer is a strict chain; everything else waits on it.
**Detail:** [MONTH_3_4_PLAN.md](MONTH_3_4_PLAN.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

> **Why this month changed.** As originally written, M3 asked for full web parity, onboarding, settings, sensitive-public rendering, offline read-only, iCal export and timezone work — _and_ assumed auth was already done. With M2's auth debt and an API client the plan never listed, that is ~6–7 weeks of work in a 4-week slot. Two items moved to M4 (below) so the MVP gate can still hold.

### Week 9 — prerequisites (both)

- [ ] Clear the Month 1 carry-over: three Supabase environments, secrets store, schema sign-off, migrations applied to dev + staging, working staging deploy.
- [ ] Merge the Month 2 branch after `pnpm db:reset` proves the migration chain applies from scratch.
- [ ] ⊕ **Start Apple Developer Program enrolment.** Long lead (verification can take ~2 weeks) and it gates _three_ separate deliverables: Apple Sign-In, APNs push keys, and TestFlight distribution to the M4 testers.

### Scott (backend)

- [ ] **Auth flows** (M2 debt): email/password, Google, Apple Sign-In via Supabase Auth. Session refresh + deep-link callback for expo-router.
- [ ] Remaining M3 API surface: `/healthz`, `/me` (GET/PATCH/DELETE), `/me/notification-preferences`, `/me/devices` (+ delete), `/friend-code`, `/friend-code/rotate`, `/export/ical`.
- [ ] **Timezone semantics decision + contract fix.** The contract currently specifies that `PATCH /me` recomputes `utc_*` for _all_ the user's events on a timezone change. Implemented literally, that moves the user's whole calendar. Correct semantics and amend the spec before building.
- [ ] Close the `utc_start` divergence: the DB trigger and the recurrence engine resolve DST gap/fold hours differently. Decide and document which is authoritative.
- [ ] ⊕ **Edge Function integration tests** against the local Supabase stack. Every critical M2 finding would have been caught by one test that actually called the endpoint.

### Arlo (frontend)

- [ ] **`packages/api-client`**: typed client over the generated contract types, token injection + refresh, `ApiResult` normalisation, and a cache seam for offline. UI never calls `fetch`/Supabase directly.
- [ ] Wire the mobile calendar to real data (replace the stub occurrence list).
- [ ] **Web: read-only calendar parity** — month view, week strip, time-sheet against shared logic. _Event management on web moves to M4._
- [ ] Extract `packages/calendar-core` (layout maths, overlap columns, holidays) **before** writing web views, so the two platforms share logic and not markup.
- [ ] Onboarding: username, display name, avatar upload (circle crop → `avatars/<user_id>/…`), birthday, default visibility, timezone (auto-detect + override).
- [ ] Settings: notification defaults, default visibility, timezone management, account settings, data export (iCal).
- [ ] Friend code UI: 8-char code as QR + native share sheet.
- [ ] Sensitive-public rendering: grey "Busy" blocks (time/duration only) in the owner's own view.
- [ ] ⊕ **Empty / error / loading states** as explicit work: offline indicator, no-events, failed load, parse failures later.
- [ ] ⊕ **Test runners for both apps** — neither `apps/web` nor `apps/mobile` has a `test` script today.

### Moved out of Month 3

- **Full event management on web** → M4. Web stays the dev/test environment as read-only.
- **Offline read-only cache** → M4. Least coupled to anything else.

### Risks

- ⚠️ The auth → api-client → screens chain is strictly serial. Parallelising UI against stubs is exactly what produced M2's untested backend.
- ⚠️ Web parity is the most underestimated line in the original plan: the M2 calendar is React Native and none of it runs in Next.js.
- ⚠️ Timezone recomputation is subtle and the contract currently describes the wrong behaviour.

---

## Month 4 (Weeks 13–16) — Spillover, then MVP Testing & Stabilisation ⬅️ RESCOPED

**Focus:** Close the two items moved from M3 in weeks 13–14, then no new features: dogfood, bug-bash, hand to 10 real users, clear the gate.
**Detail:** [MONTH_3_4_PLAN.md](MONTH_3_4_PLAN.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)

### Weeks 13–14 — carried from M3

- [ ] Event management on web (create/edit/delete, occurrence overrides).
- [ ] Offline read-only: cache last-loaded calendar by month; clear offline indicator; edits require connection. (Full offline editing → Post-V1.)
- [ ] **Push on real devices**: EAS development build (push no longer works in Expo Go on Android), APNs key, FCM credentials, and enable the `pg_cron` schedule — it is committed but commented out, so nothing currently fires.

### Weeks 14–16 — stabilisation (both)

- [ ] **Dogfood:** use PlanPal as primary calendar for ≥2 consecutive weeks before any external testing. Requires installable builds on both devs' phones from day one of M4.
- [ ] Internal bug bash: all recurrence edge cases (DST both directions, leap year, week rollover, single-occurrence edits), notification delivery on **real iOS + Android devices**, visibility enforcement.
- [ ] Recruit 10 real users (esp. people with variable-schedule jobs). **Start recruiting in M3** — this is lead time, not engineering time. Observe unaided; document every confusion point.
- [ ] Fix all **critical + high** bugs. Medium bugs carry forward with a known-issues list.
- [ ] Device matrix testing: Android 8/10/12/14, iOS 16/17/18 — **physical devices, not simulators.** A cloud device farm uses real hardware and satisfies this. Confirm Android 8 (API 26) is still above the Expo SDK floor in use.
- [ ] ⊕ **Backup & disaster recovery** (before external users): Supabase backup cadence, a _tested_ restore, and RLS-policy regression tests.

### MVP exit gate (verify all before Beta)

- [ ] Event CRUD stable · recurrence edge-case tests pass · push works on real devices · 2+ weeks daily dogfood done · 10 users tested · critical/high bugs cleared.

### Risks

- ⚠️ Push delivery varies wildly by device/OS/power-saving — do not trust simulators.
- ⚠️ If M3 slips, it eats the stabilisation window that exists specifically to protect this gate. Decide a slip in week 12, not week 15.
- ⚠️ Sourcing seven physical devices is procurement lead time. Start in M3.

---

# PHASE 2 — Beta (Months 5–8)

**Goal:** 50–200 users in closed beta; validate screenshot import + social features with real schedules.
**Beta exit gate (before app store submission):** privacy QA passes with **zero event-leakage** · parsing hits acceptable accuracy on 5 target formats · closed beta ran ≥4 weeks.

> **Day-one action:** Set Claude API cost alerts before the first parse job runs.

---

## Month 5 (Weeks 17–20) — Screenshot-to-Schedule Pipeline (B1) + Variable-Schedule (B2)

**Focus:** Build the server-side parsing pipeline end to end. Pipeline runs **entirely server-side** (never on-device) so the model can be upgraded without app releases.

### Scott (backend)

- [ ] Upload flow: client → Supabase Storage via presigned URL → enqueue BullMQ (Upstash Redis) parse job → return job ID immediately. _(The private `screenshots` bucket + owner-only RLS already exist.)_
- [ ] Stage 1 — OCR: Claude vision primary; AWS Textract fallback auto-triggered on low-confidence.
- [ ] Stage 2 — LLM extraction: structured prompt → JSON candidate events (name/date/start/end/location/recurrence). On failure return empty array + reason code, **not** an error.
- [ ] Stage 3 — Normalization: resolve relative dates ("next Tuesday") vs user's date + IANA tz; flag dates outside 180-day window.
- [ ] Stage 4 — Conflict detection: overlap-check vs existing calendar; flag (don't block) in review UI.
- [ ] Job completion: push + in-app badge with event count.
- [ ] Rate limit: 15 parse requests/user/day (cost guardrail).
- [ ] B2: detect when parsed dates align with an existing variable-schedule routine → offer to pre-fill that week (per-week confirmation, never auto-commit).

### Arlo (frontend)

- [ ] Upload UX: camera roll / take photo / web file upload; job-progress + completion states.
- [ ] Privacy disclosure notice (persistent): images sent to third-party AI, not retained beyond parse session. **Required for App Store.**

### Cross-cutting starting here

- [ ] ⊕ **Cost monitoring & budget**: Claude API daily alerts, a monthly infra budget line (Supabase, Upstash, Textract), and a spend kill-switch threshold.
- [ ] ⊕ **User support & feedback loop**: in-app feedback channel + a triage SLA for the closed beta.

### Risks

- ⚠️ LLM parsing cost can scale unexpectedly — monitor daily Claude spend from day 1. Rate limit caps per-user, not coordinated overuse.
- ⚠️ Any generated recurrence rule must be validated against the engine's supported subset on write, or it will fail silently on read.

---

## Month 6 (Weeks 21–24) — Review/Confirm UI, Friend System (B3) + Shared Calendar (B4) begin

**Focus:** Make parsed events safe to import (explicit approval), and stand up the social graph.

### Arlo (frontend) — Review & Confirmation UI + B3 UI

- [ ] Review sheet: every parsed event = editable card; **nothing commits without explicit approval.**
- [ ] Card: title, date, start/end, location, confidence badge (High/Med/Low). Low-confidence cards visually distinct, require individual confirm (no "Import all").
- [ ] Edit-before-import; changes stay in review state until confirmed.
- [ ] Import history screen: past imports + per-batch "Undo import" (7-day window).
- [ ] Re-parse: crop/annotate + resubmit without leaving review.
- [ ] Add-friend flow: paste code or scan QR → friend request (mutual accept required). **No search, no directory** — out-of-band sharing only.

### Scott (backend) — Friend graph

- [ ] Friend codes: refreshable, old codes expire after 30 days, existing connections unaffected. **Switch `generate_friend_code()` from `random()` to `gen_random_bytes()`** — a predictable PRNG is the wrong primitive for something gating calendar access.
- [ ] Friend connection API: request/accept/unfriend/block/report. **A `reports` table does not exist yet** — the contract has the endpoint, the schema does not.
- [ ] Rate limit: max 20 friend requests/hour/account (anti code-guessing).
- [ ] Begin B4 backend: shared-event queries for Friends view.

### Dependencies & parallelization

- Review UI depends on B1 pipeline (Month 5). B3/B4/B5 overlap heavily — sequence carefully to avoid privacy regressions.

---

## Month 7 (Weeks 25–28) — Shared Calendar View (B4) + Privacy/Visibility (B5)

**Focus:** Ship the Friends view and the privacy enforcement that gates Beta. **Privacy has zero tolerance for bugs.**

### Arlo (frontend)

- [ ] Friends view: My Calendar ↔ Friends toggle; same month/week/time-sheet layout.
- [ ] Friend avatar bubbles on month grid; tap → filter time-sheet to that friend's day.
- [ ] Per-friend display toggles (filter panel, persists across sessions).
- [ ] Friend bars color-coded by friend (auto hue, adjustable); overlaps as parallel columns.
- [ ] Friend list screen: avatar, display name, optional last-active (opt-in, off by default).
- [ ] Visibility controls UI: Private / Shared-all / Shared-select (multi-select picker) / Sensitive-public; bulk visibility audit screen; per-event visibility change log display.

### Scott (backend)

- [ ] Supabase Realtime for **Friends view only** (other views: pull-to-refresh).
- [ ] **Sensitive-public enforcement: redact title/notes/location server-side at query time** (not display time) — a compromised client can't extract hidden data. This is the first `SECURITY DEFINER` RPC in the codebase; **`revoke execute from public, anon, authenticated` on it** — the M2 review found exactly that omission shipping a full-database read.
- [ ] Selective sharing logic (share with A, not B).
- [ ] GDPR/CCPA: account deletion removes events from all friends' views within 24h; unfriend removes shared visibility immediately both sides; iCal export.
- [ ] ⊕ **Mandatory ≥90% coverage on the redaction logic** — already in `docs/TESTING.md`; wire the threshold when the code lands.

### Cross-cutting starting here

- [ ] ⊕ **Legal / compliance artifacts** drafted: Privacy Policy, Terms of Service, DPA with Anthropic, written data-retention policy. Finalised in M8.

### Dependencies

- B5 server-side redaction must land before any shared view is exposed to testers.

### Risks

- ⚠️ One private event leaking into a friend's view = critical incident. Plan a dedicated security QA pass (Month 8).

---

## Month 8 (Weeks 29–32) — Beta hardening, privacy QA, closed beta run

**Focus:** Run the closed beta ≥4 weeks, pass the security gate, prep for app store submission.

### Both

- [ ] **Dedicated privacy/security QA pass:** every combination of visibility, selective sharing, sensitive-public, unfriend, block, account deletion. Zero leakage required. Include a **function-grant audit** — every `SECURITY DEFINER` function checked for a `PUBLIC` execute grant.
- [ ] Validate parsing accuracy on all 5 target formats (work rosters, school timetables, event flyers, calendar screenshots, PDFs ≤10pp).
- [ ] Run closed beta with 50–200 users for ≥4 weeks; triage feedback; fix critical issues.
- [ ] Monitor Claude API daily spend; tune rate limits per real usage.
- [ ] Confirm App Store privacy disclosures (third-party AI processing) in policy + listing.
- [ ] ⊕ Finalise legal artifacts drafted in M7.

### Beta exit gate

- [ ] Privacy QA zero-leakage · parsing accuracy acceptable · beta ran ≥4 weeks.

---

# PHASE 3 — V1 (Months 9–12)

**Goal:** Public launch on App Store, Google Play, and web with stable calendar export/one-way push + social sharing.
**Highest-load phase** (40–50 hrs/wk): polish + submission prep run simultaneously.
**Launch gate:** all store privacy reqs met · load test passed · closed beta issues resolved · both devs sign off on the "ship it" bar.

> **Start long-lead approvals in Month 9 (wk 33–35) — they outlast the build:**
>
> - Review App Store Guidelines 5.1 (Privacy) & 4.5 (Push) in wk 33.
> - Snap Creative Kit review: start wk 35 (2–4 weeks).
> - Google OAuth verification: start wk 35 (4–6 weeks).

---

## Month 9 (Weeks 33–36) — Calendar Export (V1.1) + Social Integrations (V1.2) begin

**Focus:** Start simple — iCal export first. Kick off external approvals immediately.

### Scott (backend)

- [ ] **Step 1 — iCal export** (wk 33–35): standards-compliant `.ics` of non-private events. _(The M3 endpoint is the minimum version; this is the standards-compliant one, incl. EXDATE for cancels and separate VEVENTs for overrides.)_
- [ ] "Add to Google/Apple Calendar" deep links (zero server integration).
- [ ] Shareable event link: public URL → `.ics` download for non-users.
- [ ] **Step 2 — One-way export** begins (wk 35–38): Google Calendar push via OAuth (push only, no read/import).
- [ ] **Submit Google OAuth verification (wk 35)** and **start Snap Creative Kit registration (wk 35).**

### Arlo (frontend)

- [ ] Export UI; per-event "Add to calendar" buttons.
- [ ] **Instagram** share-to-Stories via `instagram-stories://share` (event card sticker; no API key). Sensitive-public/private cannot be shared externally.

### Cross-cutting starting here

- [ ] ⊕ **Release / versioning policy**: Expo OTA vs. store-build, staged rollout, and rollback beyond launch day.

---

## Month 10 (Weeks 37–40) — Finish one-way sync, Social Integrations, Polish (V1.3) begins

### Scott (backend)

- [ ] Google one-way push complete; **Outlook one-way push** via Microsoft Graph (push only).
- [ ] Disconnect flow: revoking connection removes all PlanPal-pushed events (confirm before disconnect).
- [ ] Supabase read performance: indexes on hot paths (events by user+date range, friend connections by user, notifications by send time). Profile with **10,000 seeded accounts.**
- [ ] **Rewrite the notification scheduler for scale.** The M2 design expands occurrences per user, per minute — correct at beta scale, will not survive 10,000 accounts. Replace with a materialised upcoming-occurrence queue.

### Arlo (frontend)

- [ ] **Snapchat** via Snap Creative Kit SDK (event card sticker + PlanPal deep link) — once review clears.
- [ ] **Discord** via native share sheet (formatted summary; outbound only). Optional: Discord bot if time allows.
- [ ] Accessibility audit begins: VoiceOver/TalkBack, Dynamic Type at max, high-contrast, focus order.

### Note

- ⚠️ Two-way sync is **explicitly Post-V1** — do not build it. Screenshot import is the bridge for users who want Google/Outlook events in.

---

## Month 11 (Weeks 41–44) — Platform Polish complete (V1.3) + Launch Sequence begins (V1.4)

### Arlo (frontend)

- [ ] Finish accessibility audit.
- [ ] Home screen widgets: iOS WidgetKit + Android App Widget (today + next event, 15-min refresh).
- [ ] App store assets (screenshots, listings, icons).

### Scott (backend)

- [ ] Performance targets: TTI < 2s on mid-tier Android / 4G; 60fps scroll/swipe; 50+ events without frame drops.
- [ ] Load testing; performance hardening.

### Both — Launch sequence start

- [ ] Internal validation (wk 42–43): use PlanPal exclusively 2 weeks post-polish; fix remaining issues.
- [ ] Begin extended closed beta (wk 43–46): expand to 200–500 users via waitlist; focus on integration reliability + social stability at scale.

---

## Month 12 (Weeks 45–48) — Submission & Public Launch (V1.4)

### Both

- [ ] Finish extended closed beta (through wk 46).
- [ ] **App Store + Google Play submission (wk 46):** complete privacy manifests, data-usage descriptions, age ratings. **Budget 2 weeks for rejection/resubmission.**
- [ ] Deploy PWA to public domain simultaneously with mobile submission.
- [ ] **Public launch (wk 48):** monitor error rates, push delivery, parse success in first 72h. Keep an integration rollback plan ready.

### Launch gate

- [ ] All store privacy reqs met · load test passed · beta issues resolved · both devs sign off.

### Risks

- ⚠️ Apple rejects for vague AI privacy language, promotional-looking notifications, weak account deletion. Build in 2 weeks for resubmission.

---

# PHASE 4 — Post-V1 (Month 13+) — Plugin Foundation & Growth

**Trigger:** Public ≥4 weeks **and** ≥500 active users. Build what users ask for, not what seems cool. Pace TBD; ownership split revisited post-launch. Dates intentionally omitted.

### Backlog (priority-ordered, not scheduled)

1. **Full bidirectional sync** — Google (read+write, configurable per-event source-of-truth), Apple via CalDAV (budget a full sprint for recurring-edit semantics: THIS / THIS+FOLLOWING / ALL), Outlook/M365 via Graph. _~2–3 sprints per platform._
2. **Internal plugin API** — OAuth 2.0 scoped tokens, webhook triggers (`event_created/updated/deleted`), plugin manifest schema. Used by first-party integrations before any external exposure.
3. **First-party integrations on the internal API** — Canvas LMS (assignment due dates + class sessions), Slack (busy status on active shared event), plus most-requested beta/V1 asks.
4. **External developer preview** — publish SDK docs + sandbox; invite 3–5 developers; read-only scopes first to limit blast radius.
5. **Plugin directory** — in-app browsable integrations, one-tap install + permission management.
6. **Companion apps** — Apple Watch / Wear OS (today + next event). Data model already supports this.
7. **Full offline editing** with queue + conflict resolution on reconnect.
8. **Advanced realtime** — extend Supabase Realtime beyond Friends view.
9. **Group calendars** — shared space any invited user can add to.
10. **More LMS** — Blackboard, Moodle.

---

# Cross-Cutting Workstream Index

Each ⊕ item is now scheduled inside the month where it starts. This index exists so nothing is lost, not as a separate to-do list.

| Workstream                        | Starts                 | Owner | Status                                                             |
| --------------------------------- | ---------------------- | ----- | ------------------------------------------------------------------ |
| Environments & secrets management | M1 → **carried to M3** | Scott | ⬜ Not started                                                     |
| Automated test strategy           | M1                     | both  | ✅ Documented + now enforced in CI                                 |
| Database migration strategy       | M1                     | Scott | ✅ Documented (`docs/BOOTSTRAP.md`), forward-only                  |
| Success metrics / KPIs            | M1                     | both  | 🟡 Contracts + web SDK done; **mobile native SDKs still deferred** |
| Design system / UX baseline       | M1                     | Arlo  | ✅ Tokens + contracts                                              |
| Apple Developer enrolment         | **M3**                 | both  | ⬜ Long lead — gates Apple Sign-In, APNs, TestFlight               |
| Edge Function integration tests   | **M3**                 | Scott | ⬜ Zero today                                                      |
| App-level test runners            | **M3**                 | Arlo  | ⬜ Neither app has a `test` script                                 |
| Empty / error / loading states    | M3                     | Arlo  | ⬜                                                                 |
| i18n / localization posture       | M2 → **overdue**       | both  | ⬜ Decision never recorded                                         |
| Backup & disaster recovery        | M4                     | Scott | ⬜ Before external users                                           |
| Cost monitoring & budget          | M5                     | both  | ⬜                                                                 |
| User support & feedback loop      | M5                     | both  | ⬜                                                                 |
| Legal / compliance artifacts      | M7 draft → M8 final    | both  | ⬜                                                                 |
| Release / versioning policy       | M9                     | both  | ⬜                                                                 |

---

# Cross-Cutting Notes

**Tech stack (locked):** Supabase (DB/auth/storage/RLS/realtime) · React Native + Expo · Next.js (monorepo) · Claude API (parsing) · BullMQ on Upstash Redis · Expo Notifications · Sentry (errors) · PostHog (analytics) · GitHub Actions (CI/CD).

**Standing rules:**

- Ownership by **layer**, not feature. Both review before merge.
- OpenAPI spec is the contract — keep it current; it's the integration unblocker. **A contract change needs both-dev sign-off.**
- Each phase has a **hard gate** — do not advance until met.
- Reserve 20–30% of every month for non-feature work (already excluded from estimates).
- No new dependencies beyond the locked stack without explicit team approval.
- **Recurrence is implemented once**, in `packages/recurrence`. Anything else that needs it consumes the generated mirror; CI fails on drift.
- **Every `SECURITY DEFINER` function revokes execute from `public`, `anon` and `authenticated`.**

**Top recurring risks across the project:**

1. Recurrence edge cases (DST, leap year, week rollover) — MVP. _Engine is well tested; integration is not._
2. Push delivery variance across devices/OS — MVP.
3. Timezone re-computation correctness — MVP. _Contract currently specifies incorrect behaviour._
4. Privacy/visibility leakage — Beta (zero tolerance). _One instance already found and fixed in M2._
5. Claude API cost scaling — Beta onward (alerts day 1).
6. App store + OAuth/Snap approval lead times — V1 (start in Month 9). _Apple enrolment is needed far earlier, in M3._

---

# What changed in this revision

Revised 2026-09-01 after the Month 2 code review. Substantive changes, for Scott's review:

1. **Added a status layer.** M1 and M2 tasks are now marked done/not-done against what is actually in the repo, and a "Where we actually are" table opens the document. The plan had no way to tell you what had been built.
2. **Auth moved M2 → M3.** It was week-7 M2 work that never started. Pretending otherwise made M3 look achievable.
3. **M3 rescoped.** Web event management and offline read-only moved to M4; web is read-only parity in M3. Added the two workstreams the plan never listed but that everything depends on: the client API layer, and clearing M1's environment carry-over.
4. **M4 rescoped** to weeks 13–14 spillover + weeks 14–16 stabilisation, and push-on-real-devices moved here with its full dependency chain (EAS build, APNs, FCM, enabling the cron schedule).
5. **Cross-cutting items inlined** into their anchor months with an index at the bottom. As a standalone trailing section they were being skipped.
6. **New items** the original plan omitted: Apple Developer enrolment lead time, EAS build setup, Edge Function integration tests, app-level test runners, `packages/calendar-core` extraction, the `reports` table gap, the friend-code PRNG, and the M10 scheduler rewrite for scale.
7. **Two corrections to specified behaviour**: the `PATCH /me` timezone recomputation described in the contract would corrupt calendars, and the `utc_start` DST divergence between the trigger and the engine needs a documented authority.
