# PlanPal — Month 4 Execution Plan (Weeks 13–16)

**Derived from:** [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — _Month 4: Spillover, then MVP Testing & Stabilisation_
**Team:** Arlo (frontend) · Scott (backend)
**Month goal:** Close the two features carried from Month 3, get push working on real hardware, then stop building and clear the MVP exit gate.

> **Why phased this way:** the original plan said "no new features" for all four weeks. That only works if Month 3 lands whole, and Month 3 is deliberately over-subscribed. Weeks 13–14 are therefore explicit spillover; the feature freeze starts **end of week 14** and is real from there. Dogfooding needs installable builds on both devs' phones from _day one_, which is why the EAS work is front-loaded rather than treated as a testing detail.

---

## Critical-path summary

```
Phase 0 (EAS builds + push) ──► Phase 2 (Dogfood, wk 14-16)  ──► Phase 4 (Exit gate)
                                        ▲                              ▲
Phase 1 (M3 spillover, wk 13-14) ───────┘                              │
Phase 3 (Bug bash + device matrix + external testers) ─────────────────┘
```

- **Phase 0 finishes in week 13.** Dogfooding cannot start without an installable build, and two weeks of dogfooding is an exit-gate requirement — so a week-15 build makes the gate arithmetically unreachable.
- **Feature freeze: end of week 14.** After that, bug fixes only.

---

## Phase 0 — Real builds & push on hardware (Week 13) ⚠️ GATES DOGFOODING

_Goal: PlanPal installed and receiving notifications on both devs' actual phones._

### Both

- [ ] **EAS Build set up** for iOS and Android development builds. Push notifications no longer work in Expo Go on Android (SDK 53+), so a dev build is mandatory — and it is the same mechanism M4's TestFlight distribution needs.
- [ ] **APNs key** from the Apple Developer account (enrolled in M3 week 9 — if enrolment slipped, this is the point where the whole month blocks).
- [ ] **FCM credentials** + `google-services.json` for Android.

### Scott (backend)

- [ ] **Enable the `pg_cron` schedule.** It is committed but commented out in `20260614000002`, so the scheduler has never actually fired. Requires `pg_net`, the function URL, and `CRON_SECRET` set in the project vault.
- [ ] Verify the scheduler end-to-end against real `notification_preferences` rows: multiple lead times, quiet hours across an overnight window, and a recurring series firing on more than one occurrence.
- [ ] Confirm dead-token pruning works — send to a deregistered device and check the `devices` row is removed.

**Exit:** both devs have PlanPal on their own phone · a reminder for a _recurring_ event arrives on iOS and Android · quiet hours suppress correctly.

---

## Phase 1 — Month 3 spillover (Weeks 13–14)

_Goal: finish the two items deliberately moved out of M3. Nothing else is added._

### Arlo (frontend)

- [ ] **Event management on web**: create, edit, delete, plus occurrence override and cancel — against `packages/calendar-core` and `packages/api-client` from M3. Web then has full parity and becomes the primary dev/test environment as intended.
- [ ] **Offline read-only**: cache the last-loaded calendar, show a clear offline indicator, block edits with an explanatory state rather than a failure.
  - Cache **by month**, not by arbitrary `(from,to)` window, or the cache never hits twice.
  - AsyncStorage (mobile) / IndexedDB (web), behind the cache seam built into `api-client` in M3.
  - Full offline _editing_ stays Post-V1.

**Exit (end of week 14):** web reaches feature parity with mobile · the app opens and shows the last-known calendar with no network · **feature freeze begins.**

---

## Phase 2 — Dogfooding (Weeks 14–16)

_Goal: two consecutive weeks of both devs using PlanPal as their primary calendar. This is an exit-gate requirement, not a nice-to-have._

### Both

- [ ] Migrate real personal schedules into PlanPal and use it as the primary calendar for **≥2 consecutive weeks**.
- [ ] Keep a shared running log of every friction point, not just crashes — confusion is the signal that matters before external testers arrive.
- [ ] At least one dev sets a variable-schedule routine and lives with the placeholder behaviour.
- [ ] Cross-timezone check: one dev changes device timezone for a day and confirms nothing shifts.

**Exit:** 14 consecutive days of daily use by both devs, logged.

---

## Phase 3 — Bug bash, device matrix, external testers (Weeks 14–16)

### Internal bug bash (both)

- [ ] **Recurrence edge cases** — the project's #1 risk. Explicitly exercise: spring-forward gap, fall-back fold, leap day, week rollover across a year boundary, `COUNT` vs `UNTIL`, bi-weekly with a mid-week start, single-occurrence edit then cancel, and an occurrence override that changes the timezone.
- [ ] **Notification delivery** on real iOS + Android, including with battery saver / Doze active and the app force-quit.
- [ ] **Visibility enforcement** for the owner's own view (private, shared-all, sensitive-public). _Cross-user leakage cannot be fully tested until the friend graph lands in M6 — record that as a known limit of this gate._
- [ ] Event CRUD stability under repeated edit/cancel/restore cycles.

### Device matrix (both)

- [ ] Android 8 / 10 / 12 / 14 and iOS 16 / 17 / 18 — **physical devices, not simulators.**
  - Seven devices is procurement lead time; start sourcing in M3. A cloud farm (Firebase Test Lab, BrowserStack) runs real hardware and satisfies this at a fraction of the cost.
  - **Confirm Android 8 (API 26) is still above the floor for the Expo SDK in use.** If it is not, the matrix changes and the plan's target OS range needs revising.

### External testers (both)

- [ ] **Ten real users**, weighted toward people with variable-schedule jobs. Identified in M3; onboarded here.
- [ ] iOS distribution via **TestFlight** (Apple account again); Android via internal testing track or direct APK.
- [ ] **Observe unaided.** Do not explain the UI. Document every confusion point verbatim.
- [ ] Triage: fix all **critical + high**. Mediums go on a written known-issues list that carries into Beta.

**Exit:** matrix complete · 10 users onboarded and observed · critical/high queue empty.

---

## Phase 4 — Reliability & the gate (Week 16)

### Scott (backend) ⊕

- [ ] **Backup & disaster recovery** — required _before_ external users, and currently unscheduled anywhere else:
  - Supabase backup cadence configured and documented.
  - **A restore actually performed and verified**, not just enabled. An untested backup is not a backup.
  - RLS-policy regression tests (built in M3 Phase 7) running in CI.
- [ ] Confirm `notification_sends` retention pruning runs and the table is not growing unbounded.

### Both

- [ ] Walk the MVP exit gate item by item and record evidence for each — not a self-assessment.

---

## MVP exit gate (all must be true before Beta)

| #   | Criterion                         | Evidence required                                                                                 |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | Event CRUD stable                 | Integration tests green + no open critical/high CRUD bugs                                         |
| 2   | Recurrence passes edge-case tests | Engine suite green at ≥90% coverage **and** the Phase 3 manual DST/leap/rollover checklist signed |
| 3   | Push works on real devices        | A recurring-event reminder received on physical iOS _and_ Android, with the app backgrounded      |
| 4   | Both devs used it daily ≥2 weeks  | 14-day dogfood log                                                                                |
| 5   | 10 real users tested              | Session notes per user                                                                            |
| 6   | All critical + high bugs fixed    | Empty queue; mediums on a written known-issues list                                               |
| 7   | Backups restorable                | A completed test restore, dated                                                                   |

---

## Dependencies & sequencing (at a glance)

| Item                            | Blocks                             | Must finish by                                                |
| ------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| Apple Developer membership (M3) | APNs key, TestFlight               | Before week 13                                                |
| EAS dev builds (Phase 0)        | Dogfooding, device matrix, testers | Week 13                                                       |
| `pg_cron` enabled (Phase 0)     | Gate criterion 3                   | Week 13                                                       |
| M3 spillover (Phase 1)          | Feature freeze                     | End of week 14                                                |
| Dogfood start (Phase 2)         | Gate criterion 4                   | **Week 14 at the latest** — two weeks must fit before week 16 |
| Tester recruitment (M3)         | Gate criterion 5                   | Onboard by week 15                                            |

## Risks (Month 4)

- ⚠️ **Dogfooding is arithmetically fragile.** Two consecutive weeks inside a four-week month means builds must exist by week 13 and dogfooding must start by week 14. A one-week slip in Phase 0 makes gate criterion 4 unreachable without extending the month.
- ⚠️ **Push delivery varies wildly** by device, OS version and power-saving mode. Simulators prove nothing. Budget real time for Doze/battery-saver behaviour on Android.
- ⚠️ **Apple is a single point of failure** for three gate-relevant things (Sign-In, APNs, TestFlight). If M3 enrolment slipped, escalate in week 13 rather than working around it.
- ⚠️ **Visibility enforcement cannot be fully validated this month** — there is no friend graph until M6, so criterion 6 covers the owner's own view only. Record this explicitly so the Beta privacy QA pass does not assume it was already covered.
- ⚠️ **Spillover creep.** Weeks 13–14 are for the two named items. Anything else that "just needs finishing" pushes into the stabilisation window that exists to protect the gate.

## Month 4 exit checklist

- [ ] EAS builds installed on both devs' phones; push verified on physical iOS + Android.
- [ ] `pg_cron` scheduler live and firing for recurring events.
- [ ] Web at full parity; offline read-only shipped.
- [ ] Feature freeze held from end of week 14.
- [ ] 14-day dogfood log complete for both devs.
- [ ] Device matrix complete on physical hardware.
- [ ] 10 external users onboarded, observed, and their confusion points documented.
- [ ] Critical + high bug queue empty; known-issues list written.
- [ ] Backup restore performed and dated; RLS regression tests in CI.
- [ ] **All seven gate criteria evidenced — then, and only then, start Beta.**

> **Capacity note:** Reserve **20–30%** of the month for non-feature work — it is _not_ included above. In a stabilisation month that reserve is usually _under_-estimated: bug triage, tester support and device wrangling are the month's real workload.
