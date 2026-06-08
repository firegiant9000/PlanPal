# PlanPal — Month 1 Execution Plan (Weeks 1–4)

**Derived from:** [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) — *Month 1: Foundations: Data Model + Calendar Engine kickoff*
**Team:** Arlo (frontend) · Scott (backend)
**Month goal:** Lock the load-bearing foundations — schema and API contract — before parallel feature work begins in Month 2.

> **Why phased this way:** Month 1 has two hard blockers — the **OpenAPI spec** (both devs block on it) and the **core schema** (must be stable before Arlo's M3 work in wk 5). The phases below are ordered by *dependency*, not by person. Phase 1 unblocks everyone; Phase 2 is the highest-risk work; later phases can run in parallel once the contract is set.

---

## Critical-path summary

```
Phase 0 (Bootstrap) ──► Phase 1 (Contract) ──► Phase 2 (Schema) ──► Phase 4 (Recurrence kickoff)
                                  │
                                  └──► Phase 3 (Scaffolds + CI/CD)   [parallel after contract]
```

- **Finish Phase 1 (OpenAPI spec) by end of week 2.** It is the single unblocker for both devs.
- **Schema (Phase 2) must be stable before week 5.** Over-invest in review now; post-Beta schema fixes are expensive.

---

## Phase 0 — Project & Environment Bootstrap (Week 1)

*Goal: stand up the accounts, repo, and environments so all later work has somewhere to live. No blockers — start day 1.*

### Scott (backend)
- [ ] Provision Supabase project: Postgres, Auth (email/password + Google + Apple), storage buckets (`avatars`, `screenshots`), baseline row-level security policies.
- [ ] **Environments & secrets**: separate **dev / staging / prod** Supabase projects (do *not* share one across environments). Stand up a secrets store for Claude, Google OAuth, Snap, Microsoft Graph, and Supabase service-role keys; document a rotation policy.

### Arlo (frontend)
- [ ] Monorepo setup with shared TypeScript types across mobile / web / API.
- [ ] **Design system / UX baseline**: shared tokens + component skeleton so mobile and web stay consistent before parallel UI work begins.

**Exit:** Supabase projects live across all 3 environments · secrets stored & documented · monorepo initialized · design tokens scaffolded.

---

## Phase 1 — API Contract (Weeks 1–2) ⭐ CRITICAL PATH

*Goal: agree on every endpoint shape before any API coding. This unblocks both devs — finish it first.*

### Scott (backend) — lead
- [ ] **OpenAPI spec**: all endpoint shapes, request bodies, response shapes, and error codes — agreed *before* any API coding begins.

### Arlo (frontend) — co-author
- [ ] Review / co-author the OpenAPI spec from the consumer side (mobile + web).

**Exit:** OpenAPI spec finalized and committed by **end of week 2**, signed off by both devs. This is the integration contract — keep it current thereafter.

---

## Phase 2 — Core Schema & Data Model (Weeks 2–3) ⚠️ HIGHEST RISK

*Goal: get the schema right — it's load-bearing for everything. A mistake in `events`/recurrence is costly post-Beta.*

### Scott (backend)
- [x] Design & migrate core schema: `events`, `notification_preferences`, `users`, `friend_connections`, `friend_codes`. *(+`devices`; see note.)*
- [x] `events` model — **master-rule + exceptions** (no pre-generated instances):
  - `is_master`, `master_event_id`, `recurrence_rule` (RRULE), `recurrence_exception_date`
  - `local_start_time` / `local_end_time`, `timezone_id` (IANA)
  - `utc_start` / `utc_end` (derived; for indexing & conflict detection)
  - `visibility`, `color_label`
- [x] **Timezone approach:** `local_start_time + timezone_id` is source of truth; derive/store `utc_start`/`utc_end`. *(Derived by the `events_derive_utc()` trigger.)*
- [x] **Database migration strategy**: versioned, reviewable migrations with a documented rollback path. Define *how* schema changes ship safely before any are applied to staging/prod. *(Documented in docs/BOOTSTRAP.md, incl. the Phase 2 reversal block.)*

**Exit:** Schema migrated to dev + staging · migration/rollback flow documented · **both devs review the `events`/recurrence design** (over-invest here). Schema frozen as stable before week 5.
> **Status:** schema authored + documented + locally seeded. **Still open before exit:** both-dev review of `events`/recurrence, then apply to dev + staging. (`devices` was added — it's required by the frozen contract's `/me/devices` + the M2 notification scheduler; `reports` and cross-user-read RPCs are deferred — see handoff notes.)

---

## Phase 3 — App Scaffolds, CI/CD & Foundations (Weeks 2–4)

*Goal: wire up the apps and the quality gates. Can run in parallel with Phase 2 once the contract (Phase 1) is set.*

### Arlo (frontend)
- [x] Expo + Next.js app scaffolds wired to the monorepo; shared component library skeleton connected to the design tokens from Phase 0. *(Both apps implement the `@planpal/ui` Button/Text contracts; web is `next build`-verified, mobile type-checks + runs via `expo start`.)*
- [x] **CI/CD — GitHub Actions**: lint, type-check, and tests on every PR; auto-deploy staging on merge to `main`. *(`ci.yml` = lint/typecheck/test/build; `deploy-staging.yml` = Supabase migrate + web deploy, guarded on secrets.)*

### Both
- [x] **Automated test strategy**: define unit + integration + E2E coverage targets now (not after bugs appear). Mark the **recurrence engine** and **privacy redaction** as mandatory high-coverage areas. CI (above) runs them. *(Vitest harness + seed tests; bar documented in docs/TESTING.md, ≥90% on recurrence/redaction.)*
- [x] **Success metrics / KPIs**: wire PostHog + Sentry to concrete targets (activation, D7/D30 retention, parse success, push delivery, crash-free sessions). Set MVP baselines so Beta/V1 can be measured. *(Typed events in `@planpal/analytics`; baselines + wiring in docs/METRICS.md; web SDK init live, mobile native SDK deferred to the Expo config-plugin step.)*

**Exit:** Expo + Next.js apps build & run from the monorepo · CI green on PRs · staging auto-deploys on merge · test bar + KPI baselines documented.
> **Status:** scaffolds build/type-check, CI pipeline green locally (lint + typecheck + test + build). **Still open before exit:** push to GitHub so Actions run on a real PR; set the staging-deploy + PostHog/Sentry account secrets (manual, like the Phase 0 cloud steps); add the native-mobile Sentry/PostHog config plugins.

---

## Phase 4 — Recurrence Engine Kickoff (Week 4 → carries into Month 2)

*Goal: get a head start on the M2 calendar engine. Depends on stable schema (Phase 2).*

### Scott (backend)
- [x] Begin the recurrence engine: server-side occurrence expansion for a requested date range (client never expands rules). Full RRULE support (weekly/bi-weekly/custom days, end conditions, DST/leap-year handling) completes in Month 2. *(Spiked in `packages/recurrence`.)*

**Exit:** Server-side occurrence expansion spiked against the stable schema; ready to expand into full RRULE support in M2.
> **Status:** `@planpal/recurrence` (`expandOccurrences`) is a pure, zero-dependency engine expanding masters + sparse exceptions (overrides/cancels) into the contract's `EventOccurrence` shape over a ≤180-day window. Kickoff subset: `FREQ=DAILY/WEEKLY` + `INTERVAL`/`BYDAY`/`COUNT`/`UNTIL` (covers weekly/bi-weekly/custom-days), with DST-correct per-occurrence UTC via built-in `Intl`. **Hardened (this pass):** spring-forward GAP and fall-back AMBIGUOUS-hour resolution now follow the "compatible" policy (gaps shift forward, folds take the earlier instant) and leap-day + DST-boundary cases are covered by `node:test` (26 tests green). **Deferred to M2:** `MONTHLY`/`YEARLY` (birthday auto-events) + advanced BY\* (they throw, never silently drop), the `GET /occurrences` endpoint that calls the engine, reconciling the engine's UTC derivation with the Postgres `events_derive_utc()` trigger's gap/fold resolution, and the **decision to adopt `rrule`+`luxon` vs. extend the hand-rolled engine (needs team approval — locked-stack rule).**

---

## Dependencies & sequencing (at a glance)

| Item | Blocks | Must finish by |
|------|--------|----------------|
| OpenAPI spec (Phase 1) | All API + consumer work | End of week 2 |
| Core schema (Phase 2) | Arlo's M3 (wk 5), recurrence engine | Stable before week 5 |
| Storage buckets (Phase 0) | Avatar upload (M3) | Week 1 |
| `notification_preferences` (Phase 2) | Notification scheduler (M2) | Week 3 |

## Risks (Month 1)
- ⚠️ **Schema mistakes are expensive post-Beta** — over-invest in `events`/recurrence review now (Phase 2 exit requires both-dev sign-off).
- ⚠️ **Contract drift** — if the OpenAPI spec slips past week 2, both devs stall. Treat it as the week-1–2 priority.
- ⚠️ **Environment bleed** — sharing one Supabase project across dev/staging/prod will bite later; enforce separation in Phase 0.

## Month 1 exit checklist
- [ ] OpenAPI spec final & committed, both devs signed off.
- [ ] Core schema migrated and frozen-stable; migration/rollback documented.
- [ ] 3 separate Supabase environments + secrets store live.
- [ ] Monorepo + Expo/Next.js scaffolds building; CI green; staging auto-deploys.
- [ ] Design tokens, test strategy, and KPI baselines documented.
- [ ] Recurrence engine kickoff underway for Month 2.

> **Capacity note:** Reserve **20–30%** of the month for non-feature work (DevOps, reviews, support) — it is *not* included in the task estimates above.
