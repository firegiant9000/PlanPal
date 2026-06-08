# PlanPal — Month-by-Month Development Plan

**Team:** Arlo (frontend) + Scott (backend) · **Target:** V1 public launch in 12 months
**Source:** PlanPal Product Development Roadmap (MVP / Beta / V1 / Post-V1)
**Capacity assumption:** 30–50 combined hrs/week. Reserve **20–30%** of every month for non-feature work (app store, DevOps, support, reviews) — it is *not* in the task estimates below.

> **Week→Month mapping** (4 weeks ≈ 1 month):
> M1=wk 1–4 · M2=wk 5–8 · M3=wk 9–12 · M4=wk 13–16 · M5=wk 17–20 · M6=wk 21–24 · M7=wk 25–28 · M8=wk 29–32 · M9=wk 33–36 · M10=wk 37–40 · M11=wk 41–44 · M12=wk 45–48.

---

## Phase Overview

| Phase | Months | Weeks | Outcome |
|-------|--------|-------|---------|
| **MVP** — Core App & Calendar Engine | 1–4 | 1–16 | Daily-usable app, handed to 10 real testers |
| **Beta** — AI Import & Social Layer | 5–8 | 17–32 | 50–200 user closed beta; parsing + social validated |
| **V1** — Integrations & Public Launch | 9–12 | 33–48 | Public launch (App Store, Play, web) |
| **Post-V1** — Plugin Foundation & Growth | 13+ | 49+ | Pace TBD; only after 500+ active users for 4+ weeks |

**Hard sequencing gates (do not skip):**
- Don't start **Beta** until MVP is stable *and* tested by ≥10 real users.
- Don't submit to **app stores** until privacy QA passes with zero leakage + parsing hits target accuracy + closed beta ran ≥4 weeks.
- Don't start **Post-V1** until public for ≥4 weeks with ≥500 active users.

---

# PHASE 1 — MVP (Months 1–4)

**Goal:** A working app Arlo and Scott use daily, handed to 10 real test users by end of Month 4.
**MVP exit gate:** event CRUD stable · recurrence passes edge-case tests · push works on real devices · both devs used it daily for ≥2 weeks · all critical/high bugs fixed.

---

## Month 1 (Weeks 1–4) — Foundations: Data Model + Calendar Engine kickoff

**Focus:** Get the schema right (it's load-bearing for everything) and lock the API contract before parallel work begins.

### Scott (backend)
- [ ] Supabase project provisioning: Postgres, Auth (email/password + Google + Apple), storage buckets (avatars, screenshots), row-level security policies.
- [ ] Design & migrate core schema: `events`, `notification_preferences`, `users`, `friend_connections`, `friend_codes`.
  - `events`: master-rule + exceptions model (no pre-generated instances). Include `is_master`, `master_event_id`, `recurrence_rule` (RRULE), `recurrence_exception_date`, `local_start_time`/`local_end_time`, `timezone_id` (IANA), `utc_start`/`utc_end`, `visibility`, `color_label`.
  - Timezone approach: `local_start_time + timezone_id` is source of truth; derive/store `utc_start`/`utc_end` for indexing & conflict detection.
- [ ] **OpenAPI spec** — all endpoint shapes, request bodies, error codes agreed *before* any API coding.
- [ ] Begin recurrence engine (M2): server-side occurrence expansion for a requested date range.

### Arlo (frontend)
- [ ] Monorepo setup with shared TypeScript types across mobile / web / API.
- [ ] CI/CD: GitHub Actions (lint, type-check, tests on every PR; auto-deploy staging on merge to main).
- [ ] Expo + Next.js app scaffolds wired to the monorepo; shared component library skeleton.
- [ ] Review/co-author OpenAPI spec from the consumer side.

### Dependencies & parallelization
- OpenAPI spec is the **critical-path unblocker** — both devs block on it. Finish in week 1–2.
- Schema must be stable before Arlo starts M3 (week 5). Spend extra time here; post-Beta schema fixes are expensive.

### Risks
- ⚠️ A mistake in `events`/recurrence tables is costly later — over-invest in schema review now.

---

## Month 2 (Weeks 5–8) — Recurrence + Notifications + Calendar UI begins

**Focus:** Finish the calendar engine, ship the notification service, and start the mobile/web UI (M3 begins wk 5, overlaps intentionally). User profiles/auth (M4) starts wk 7.

### Scott (backend) — M2 finish + M4 start
- [ ] Recurrence engine complete: RRULE support — weekly, bi-weekly, custom days (M/W/F), end-by-date, end-after-N, repeat-forever. Handle **DST, leap years, week-number boundaries**. Client never expands rules.
- [ ] Variable-schedule routine type: flag on master event; no pre-generation; "Schedule not yet entered" placeholder behavior.
- [ ] Push notification scheduler: per-minute job → query events whose lead times fall in the next minute → dispatch via Expo Push (FCM/APNs). Driven by `notification_preferences`.
- [ ] Birthday auto-event: yearly RRULE on profile create / birthday update, Private by default.
- [ ] (wk 7) Auth flows: email/password, Google, Apple Sign-In via Supabase Auth.

### Arlo (frontend) — M3 start
- [ ] Month view: grid, current-day highlight, US federal holiday labels from public iCal feed (non-editable layer). Friend avatar bubbles stubbed.
- [ ] Swipe-up bottom sheet → week strip + vertical 24h time-sheet.
- [ ] Time-sheet bars (avatar, title, color), tap → detail, horizontal swipe between days.
- [ ] Event creation flow: title, date/time range, repeat settings (incl. variable-schedule toggle), notification prefs, visibility.

### Dependencies & parallelization
- M3 (Arlo) can only start after **API spec final + first Supabase tables stable** — confirm at start of month.
- Notification scheduler depends on `notification_preferences` schema (Month 1).

### Risks
- ⚠️ Recurrence edge cases are the #1 calendar-app bug source. Budget ≥1 full week of bug-fixing once recurrence lands (carries into Month 3).

---

## Month 3 (Weeks 9–12) — Calendar UI + Profiles/Auth complete; web parity

**Focus:** Finish M3 (UI) and M4 (profiles/auth). End the month with a feature-complete MVP ready for stabilization.

### Arlo (frontend) — M3 finish + M4 UI
- [ ] Sensitive-public rendering: gray "Busy" blocks (time/duration only) in shared contexts.
- [ ] Offline read-only: cache last-loaded calendar; clear offline indicator; edits require connection. (Full offline editing → Post-V1.)
- [ ] **Web parity in Next.js**: all calendar views + event management via shared components. Web is the primary dev/test environment.
- [ ] Onboarding flow: username, display name, avatar upload (circle crop → Supabase Storage), birthday, default visibility, timezone (auto-detect + override).
- [ ] Settings screen: notification defaults, default visibility, timezone mgmt, account settings, data export (iCal).
- [ ] Friend code generation UI: 8-char code rendered as QR + native share sheet.

### Scott (backend)
- [ ] Finalize auth (Apple Sign-In required for App Store approval).
- [ ] Friend code generation endpoint (unique 8-char, one active code per user).
- [ ] iCal data export endpoint.
- [ ] Timezone re-computation logic: recompute `utc_*` on any timezone change — **write and test before Beta.**

### Dependencies & parallelization
- M3 and M4 overlap; both depend on stable auth + schema. Avatar upload depends on Storage bucket (Month 1).

### Risks
- ⚠️ Timezone re-computation (`local_start_time + timezone_id + utc_start`) is subtle — test exhaustively this month.

---

## Month 4 (Weeks 13–16) — MVP Testing & Stabilization (M5)

**Focus:** No new features. Dogfood, bug-bash, hand to 10 real users, clear the gate.

### Both Arlo + Scott
- [ ] **Dogfood:** use PlanPal as primary calendar for ≥2 consecutive weeks before any external testing.
- [ ] Internal bug bash: all recurrence edge cases (DST, leap year, week rollover, single-occurrence edits), notification delivery on **real iOS + Android devices**, visibility enforcement.
- [ ] Recruit 10 real users (esp. people with variable-schedule jobs). Observe unaided; document every confusion point.
- [ ] Fix all **critical + high** bugs. Medium bugs carry forward with a known-issues list.
- [ ] Device matrix testing: Android 8/10/12/14, iOS 16/17/18 — **physical devices, not simulators.**

### MVP exit gate (verify all before Beta)
- [ ] Event CRUD stable · recurrence edge-case tests pass · push works on real devices · 2+ weeks daily dogfood done · 10 users tested · critical/high bugs cleared.

### Risks
- ⚠️ Push delivery varies wildly by device/OS/power-saving — do not trust simulators.

---

# PHASE 2 — Beta (Months 5–8)

**Goal:** 50–200 users in closed beta; validate screenshot import + social features with real schedules.
**Beta exit gate (before app store submission):** privacy QA passes with **zero event-leakage** · parsing hits acceptable accuracy on 5 target formats · closed beta ran ≥4 weeks.

> **Day-one action:** Set Claude API cost alerts before the first parse job runs.

---

## Month 5 (Weeks 17–20) — Screenshot-to-Schedule Pipeline (B1) + Variable-Schedule (B2)

**Focus:** Build the server-side parsing pipeline end to end. Pipeline runs **entirely server-side** (never on-device) so the model can be upgraded without app releases.

### Scott (backend)
- [ ] Upload flow: client → Supabase Storage via presigned URL → enqueue BullMQ (Upstash Redis) parse job → return job ID immediately.
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

### Dependencies & parallelization
- B2 depends on the variable-schedule type (MVP M2) and B1 parsing output.

### Risks
- ⚠️ LLM parsing cost can scale unexpectedly — monitor daily Claude spend from day 1. Rate limit caps per-user, not coordinated overuse.

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
- [ ] Friend codes: 8-char + QR; refreshable, old codes expire after 30 days, existing connections unaffected.
- [ ] Friend connection API: request/accept/unfriend/block/report (reports → internal manual queue).
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
- [ ] **Sensitive-public enforcement: redact title/notes/location server-side at query time** (not display time) — compromised client can't extract hidden data.
- [ ] Selective sharing logic (share with A, not B).
- [ ] GDPR/CCPA: account deletion removes events from all friends' views within 24h; unfriend removes shared visibility immediately both sides; iCal export.

### Dependencies & parallelization
- B5 server-side redaction must land before any shared view is exposed to testers.

### Risks
- ⚠️ One private event leaking into a friend's view = critical incident. Plan a dedicated security QA pass (Month 8).

---

## Month 8 (Weeks 29–32) — Beta hardening, privacy QA, closed beta run

**Focus:** Run the closed beta ≥4 weeks, pass the security gate, prep for app store submission.

### Both
- [ ] **Dedicated privacy/security QA pass:** every combination of visibility, selective sharing, sensitive-public, unfriend, block, account deletion. Zero leakage required.
- [ ] Validate parsing accuracy on all 5 target formats (work rosters, school timetables, event flyers, calendar screenshots, PDFs ≤10pp).
- [ ] Run closed beta with 50–200 users for ≥4 weeks; triage feedback; fix critical issues.
- [ ] Monitor Claude API daily spend; tune rate limits per real usage.
- [ ] Confirm App Store privacy disclosures (third-party AI processing) in policy + listing.

### Beta exit gate
- [ ] Privacy QA zero-leakage · parsing accuracy acceptable · beta ran ≥4 weeks.

---

# PHASE 3 — V1 (Months 9–12)

**Goal:** Public launch on App Store, Google Play, and web with stable calendar export/one-way push + social sharing.
**Highest-load phase** (40–50 hrs/wk): polish + submission prep run simultaneously.
**Launch gate:** all store privacy reqs met · load test passed · closed beta issues resolved · both devs sign off on the "ship it" bar.

> **Start long-lead approvals in Month 9 (wk 33–35) — they outlast the build:**
> - Review App Store Guidelines 5.1 (Privacy) & 4.5 (Push) in wk 33.
> - Snap Creative Kit review: start wk 35 (2–4 weeks).
> - Google OAuth verification: start wk 35 (4–6 weeks).

---

## Month 9 (Weeks 33–36) — Calendar Export (V1.1) + Social Integrations (V1.2) begin

**Focus:** Start simple — iCal export first. Kick off external approvals immediately.

### Scott (backend)
- [ ] **Step 1 — iCal export** (wk 33–35): standards-compliant `.ics` of non-private events; "Export my calendar" in settings.
- [ ] "Add to Google/Apple Calendar" deep links (zero server integration).
- [ ] Shareable event link: public URL → `.ics` download for non-users.
- [ ] **Step 2 — One-way export** begins (wk 35–38): Google Calendar push via OAuth (push only, no read/import).
- [ ] **Submit Google OAuth verification (wk 35)** and **start Snap Creative Kit registration (wk 35).**

### Arlo (frontend)
- [ ] Export UI; per-event "Add to calendar" buttons.
- [ ] **Instagram** share-to-Stories via `instagram-stories://share` (event card sticker; no API key). Sensitive-public/private cannot be shared externally.

### Dependencies
- Outlook/Google push (Step 2) continues into Month 10.

---

## Month 10 (Weeks 37–40) — Finish one-way sync, Social Integrations, Polish (V1.3) begins

### Scott (backend)
- [ ] Google one-way push complete; **Outlook one-way push** via Microsoft Graph (push only).
- [ ] Disconnect flow: revoking connection removes all PlanPal-pushed events (confirm before disconnect).
- [ ] Supabase read performance: indexes on hot paths (events by user+date range, friend connections by user, notifications by send time). Profile with **10,000 seeded accounts.**

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
1. **Full bidirectional sync** — Google (read+write, configurable per-event source-of-truth), Apple via CalDAV (budget a full sprint for recurring-edit semantics: THIS / THIS+FOLLOWING / ALL), Outlook/M365 via Graph. *~2–3 sprints per platform.*
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

# Cross-Cutting Workstreams (gaps not in the original roadmap)

These run alongside the feature phases above. Each is anchored to the month where it should *start*; most are ongoing thereafter. Owner shown where one layer is the natural lead.

## Engineering foundations — start Month 1
- [ ] **Environments & secrets management** (Scott): separate dev / staging / prod Supabase projects; secrets store for Claude, Google OAuth, Snap, Microsoft Graph, and Supabase service-role keys; documented rotation policy. *Don't share one project across environments.*
- [ ] **Automated test strategy** (both): unit + integration + E2E coverage targets, with the **recurrence engine** and **privacy redaction** as mandatory high-coverage areas. CI already runs them (Month 1 GitHub Actions) — define the bar now, not after bugs appear.
- [ ] **Database migration strategy** (Scott): versioned, reviewable migrations with a rollback path; the roadmap warns schema mistakes are expensive post-Beta but never says *how* changes ship safely.
- [ ] **Success metrics / KPIs per phase** (both): wire PostHog + Sentry to concrete targets — activation, D7/D30 retention, parse success rate, push delivery rate, crash-free sessions. Set MVP baselines so Beta/V1 can be measured against them.

## Reliability & cost — start when each phase introduces the load
- [ ] **Cost monitoring & budget** — Month 5 (Beta): Claude API daily alerts (already noted) **plus** a monthly infra budget line (Supabase, Upstash, Textract fallback) and a spend kill-switch threshold.
- [ ] **Backup & disaster recovery** — Month 4 (before external users): Supabase backup cadence, a tested restore, and RLS-policy regression tests.
- [ ] **Release / versioning** — Month 9 (V1 prep): Expo OTA vs. store-build policy, staged rollout, and rollback beyond launch day.

## Product, legal & UX — anchored to their gating month
- [ ] **Legal / compliance artifacts** — drafted Month 7, finalized Month 8 (before submission): Privacy Policy + Terms of Service as real deliverables, DPA with Anthropic, and a written data-retention policy. App Store references these but the roadmap never schedules them.
- [ ] **User support & feedback loop** — Month 5 (Beta start): in-app feedback channel + a triage SLA for the closed beta.
- [ ] **Design system / UX baseline** (Arlo) — Month 1, before parallel UI work: shared tokens/components so mobile and web stay consistent.
- [ ] **i18n / localization posture** — Month 2: decision recorded (e.g. "English-only for V1, but no hard-coded user-facing strings") so it isn't a costly retrofit.
- [ ] **Empty / error / loading states** (Arlo) — Month 3, treated as explicit UX work (offline indicator, parse failures, no-friends state), not implied.

## Social-sharing scope (recorded clarification)
PlanPal's social features are **one-way, outbound sharing only** — Instagram Stories (URL scheme), Snapchat (Creative Kit sticker + deep link), Discord (share sheet / optional outbound bot). There is **no integration *between* platforms** and **no social-graph import**: PlanPal does not read friend lists, DMs, or social data. The in-app friend system is self-contained (8-char codes / QR, mutual consent, no directory). Any richer social integration (importing platform events, social login, reading a server's events) is **out of current roadmap scope** — evaluate as Post-V1 only if users ask.

---

# Cross-Cutting Notes

**Tech stack (locked):** Supabase (DB/auth/storage/RLS/realtime) · React Native + Expo · Next.js (monorepo) · Claude API (parsing) · BullMQ on Upstash Redis · Expo Notifications · Sentry (errors) · PostHog (analytics) · GitHub Actions (CI/CD).

**Standing rules:**
- Ownership by **layer**, not feature. Both review before merge.
- OpenAPI spec is the contract — keep it current; it's the integration unblocker.
- Each phase has a **hard gate** — do not advance until met.
- Reserve 20–30% of every month for non-feature work (already excluded from estimates).
- No new dependencies beyond the locked stack without explicit team approval.

**Top recurring risks across the project:**
1. Recurrence edge cases (DST, leap year, week rollover) — MVP.
2. Push delivery variance across devices/OS — MVP.
3. Timezone re-computation correctness — MVP.
4. Privacy/visibility leakage — Beta (zero tolerance).
5. Claude API cost scaling — Beta onward (alerts day 1).
6. App store + OAuth/Snap approval lead times — V1 (start in Month 9).
