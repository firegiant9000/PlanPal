# PlanPal roadmap review, September 2026

_Prepared 2026-09-29 against `main` at `72073af`. Read-only audit of the repository, its planning documents and CI. Nothing here is a measured result. Line references are to that commit._

This review is the evidence base for the 2026-09 revision at the top of [`planning/DEVELOPMENT_PLAN.md`](planning/DEVELOPMENT_PLAN.md), which stays the canonical plan.

## 1. Decision

PlanPal's primary objective is to **finish the core product promise: one-way sharing that actually works, proven by cross-user row-level-security tests against real Postgres.** Everything else (AI parsing UI, calendar-provider sync, feature breadth) waits. After sharing works, the repository specialises in contract correctness, recurrence and timezone correctness (differential testing against an independent oracle) and calendar interoperability (an ICS feed so PlanPal events appear in the calendar the author already uses).

The reason: the README's first sentence is "a calendar app with a one-way social sharing layer", and sharing does not exist. Nine of the contract's 32 operations have no implementation, no client and no UI. The RLS story is owner-only, which is ordinary; it becomes distinctive only when a friend can read a shared event and nothing else. The recurrence engine is tested with 57 fixed cases and the README calls that "tested as a property"; it is not.

## 2. Current roadmap goals (as written)

`docs/planning/DEVELOPMENT_PLAN.md` (last revised 2026-09-01) plans twelve months toward a public V1 launch: MVP (M1 to M4), Beta with AI import and social (M5 to M8), V1 with integrations and launch (M9 to M12), Post-V1 plugins. Its "Where we actually are" table says M3, M4 and M5 are not started; PRs #3 and #6 merged them on 2026-09-03 and later. `docs/MONTH5.md` marks the parse pipeline backend complete and four UI items in progress. `docs/GATE_EVIDENCE.md` records criteria 1, 2 and 7 with evidence and criteria 3 to 6 as NOT PROVEN or NOT STARTED.

| Plan phase | Stated | Verified |
|---|---|---|
| M1 foundations | merged | yes |
| M2 recurrence, notifications, UI | built, in review | merged |
| M3, M4 calendar UI, auth, stabilisation | not started | merged (PR #3) |
| M5 AI import pipeline | not started (plan) / backend complete (MONTH5) | backend and cron worker merged; no UI calls it |
| M6 review UI, add-friend flow, friend graph API | not started | not started; no `reports` table |
| M7 friends view, selective sharing, first SECURITY DEFINER RPC, iCal export | not started | only iCal export exists |
| M8 privacy QA with zero leakage | not started | not started |
| M9 standards-compliant iCal, shareable event link | not started | export exists without VTIMEZONE |
| M10 to M12 Google/Outlook push, scheduler rewrite, launch | not started | not started |
| Post-V1 bidirectional sync, THIS+FOLLOWING | not started | not started |

## 3. Already implemented (verified in code)

- **Contract-first pipeline**: `packages/api-contract/openapi.yaml` (32 operations) generates `packages/types` and `supabase/functions/_shared/contract-types.ts`; `contract.yml` fails on drift (path-filtered on PRs).
- **Ten Edge Functions** (`supabase/functions/*`): healthz, me, events, occurrences, friend-code, parse, parse-worker, feedback, export, notify-scheduler. Events CRUD, occurrence override and cancel, occurrence listing, friend-code get and rotate all work and are exercised over HTTP by about 176 integration tests against a real local Supabase stack in CI (`ci.yml` integration job).
- **RLS on all ten tables**; deny-all on `notification_sends` and `parse_spend_ledger`; `grants.test.ts` checks seven tables and the SECURITY DEFINER allowlist (`delete_me` executable by `authenticated`; the four trigger functions revoked).
- **UTC derivation trigger** `events_derive_utc` on the master row; the DST fold divergence between engine and Postgres is measured and documented (`20260903000001_utc_index_approximation.sql:8-19`, AD-5).
- **Recurrence engine** (`packages/recurrence`): DAILY to YEARLY, INTERVAL, ordinal BYDAY, BYMONTHDAY, BYMONTH (YEARLY), BYSETPOS, WKST, COUNT/UNTIL, 10,000-occurrence and 180-day caps; 57 fixed tests with enforced coverage floors; a byte-level mirror check between the Node source and the Deno copy.
- **ICS export** (`export/index.ts`, `_shared/ical.ts`): CRLF, folding, escaping, `DTSTART;TZID`, RRULE passthrough, EXDATE, RECURRENCE-ID overrides; 17 integration tests.
- **Deploy verification** that fails on a no-op deploy (SHA stamped into `/healthz`).
- **Lint-enforced network boundary** (`@planpal/api-client` is the only network caller).

## 4. Claimed but unproven or contradicted

| Claim | Where | What the code shows |
|---|---|---|
| "Friend connections and shared visibility: Schema and API done; no UI yet" | `README.md:98` | Only the schema and friend-code exist. `listFriends`, `unfriend`, `blockUser`, `reportUser`, `listFriendOccurrences`, `listFriendRequests`, `createFriendRequest`, `acceptFriendRequest`, `declineFriendRequest` have no Edge Function, RPC, client resource or UI. |
| "Timezone correctness is tested as a property" | `README.md:84-86` | `utc-authority.test.ts:46-66` is twelve fixed (local, zone) pairs plus the fold and gap cases. No property library exists anywhere in the lockfile. |
| "All seven [tables] have rowsecurity on. Six carry explicit policies" | `README.md:68-69`, `CLAUDE.md:61`, `BOOTSTRAP.md:236`, `GATE_EVIDENCE.md:137` | Ten tables. `grants.test.ts:40-47` audits seven; `parse_jobs`, `parse_spend_ledger` and `feedback` are not in its lists. |
| "Contract drift gate: every PR" | `README.md:103` | `contract.yml` is path-filtered on PRs. |
| "Demo project separate from development" | `README.md:106-108` | `deploy-staging.yml` and `reseed-demo.yml` target the same staging project; a bad migration on merge to `main` reaches the public demo. |
| `packages/recurrence/README.md` "Supported now" list | that file, lines 24 to 54 | Says MONTHLY, YEARLY, BYMONTHDAY, BYSETPOS and ordinal BYDAY are not implemented; they are. Still lists "adopt `rrule` + `luxon`" as an open decision. |
| Contract license | `openapi.yaml:6-8` | `Proprietary` / `LicenseRef-PROPRIETARY`; the repository is MIT. |
| DEVELOPMENT_PLAN M5 "BullMQ / Upstash" | plan lines 203 to 231 | Implementation is pg_cron plus an Edge worker. |
| Migration comments promising "SECURITY DEFINER RPC" friend paths | `core_schema.sql:19,315,362` | None exist. |

## 5. Defects and gaps confirmed by inspection

1. **`friend_connections` policies are unsafe as written.** The insert policy checks only `requester_id = auth.uid()` (`core_schema.sql:378-379`); `authenticated` has direct insert, update and delete grants (line 374); the update policy lets either party change any column including `status` (lines 380 to 383). A user can insert a row with `status = 'accepted'` for any addressee, or self-accept a pending request. Because `users_select_self_or_friends` (lines 322 to 338) then exposes the whole `users` row of any "friend" (birthday, timezone, `last_active_at` regardless of `last_active_opt_in`), this is an information-disclosure path today, before any sharing feature exists. Confirm with a live test; then replace direct grants with SECURITY DEFINER RPCs for request, accept, decline, remove and block, and revoke the table grants.
2. **No friend read path for events.** `events` has only `events_owner_all` (`core_schema.sql:358`). `visibility` (`shared_all`, `shared_select`, `sensitive_public`) and `shared_with uuid[]` are stored but nothing enforces or serves them. The web `EventForm` lets a user pick `shared_all`, which does nothing.
3. **`shared_with` has no foreign key and no cleanup** on unfriend or block.
4. **Recurrence month-end clamp**: MONTHLY and YEARLY with no BY* clamp the 29th to 31st to the last day of a short month (`rrule.ts:393-394`, `438-440`); RFC 5545 skips the month. Explicit `BYMONTHDAY=31` skips correctly (`rrule.ts:270-272`). Undocumented divergence.
5. **No "this and following" edit scope**; deferred to Post-V1 in the contract (`openapi.yaml:337`).
6. **ICS export has no VTIMEZONE**; `TESTING.md:118-123` admits the Google and Outlook import checks are outstanding.
7. **Rate limiting on two of ten functions** (`parse`, `feedback`); CORS `*` on all functions; no CSP or security headers on the web app.
8. **Mobile** creates events but cannot edit or delete a series; push delivery to a real device unproven; iOS blocked on an Apple account.
9. **Backups**: `supabase db dump` omits the `on_auth_user_created` trigger; the dev project has no automated backups; the one rehearsal compared empty tables (GATE_EVIDENCE criterion 7).
10. **Open Dependabot PR #18** bumps React Native 0.79 → 0.87 in a grouped update that conflicts with the Expo SDK pin; the `expo install --check` gate should fail it. Do not merge blindly.

## 6. Technically useful future work (kept or added)

The four milestones P1 to P4 in the plan revision: real sharing through SECURITY DEFINER RPCs with server-side redaction; cross-user RLS proof against real Postgres in CI; differential recurrence testing against `rrule.js` with `fast-check`; ICS feed with VTIMEZONE and ICS import.

Old plan items that survive: M6 add-friend flow and M7 friends view collapse into P1; M8 "privacy QA with zero leakage" becomes P2's acceptance criterion; M9 "standards-compliant iCal" and "shareable event link" become P4; the M7 sensitive/public redaction rule becomes a server-side RPC requirement in P1.

## 7. Feature work that should stop

| Item | Old phase | Decision | Reason |
|---|---|---|---|
| AI screenshot import UI, review UI, upload UX, cost monitoring UI | M5, M6 | DEFERRED | Two external data processors for a feature no user asked for, ahead of the core promise. The backend stays; no UI work until P1 to P3 are done. |
| Google / Outlook one-way push (M10) and bidirectional sync (Post-V1) | M10, Post-V1 | CANCELLED unless real use later proves the ICS feed insufficient | Large OAuth and conflict surface; the ICS feed (P4) achieves "events appear in my calendar". |
| Scheduler rewrite (M11), public launch, app-store submission, closed beta, 50 to 200 users (M8 to M12) | M8 to M12 | CANCELLED | Not a commercial project; the plan's user-count gates are replaced by personal use. |
| Plugin foundation (Post-V1) | Post-V1 | CANCELLED | No evidence. |
| `reportUser` operation and `reports` table | M6 | CANCELLED; removed from the contract | Abuse reporting for a personal app with a handful of friends. |
| Offline editing and conflict handling | not in plan; recorded to close it | CANCELLED | Read-only cache is enough for a calendar. |
| Google / Apple OAuth buttons | M3 | DEFERRED | Email/password works; OAuth adds nothing to the evidence. |
| Mobile edit and delete parity | M3 | OPTIONAL | Do it only if mobile becomes the daily client; otherwise stop calling the app cross-platform in the README until it is. |
| Push notifications to a real device | M2 | OPTIONAL | Blocked on hardware and an Apple account; not on the critical path. |

## 8. Roadmap contradictions

- "Where we actually are" is three milestones stale; corrected in the revision.
- The plan's hard gates are user counts (ten testers, 500 active users); the project has one user. The revision replaces them with evidence gates.
- The README leads with sharing; the plan defers sharing to Beta after AI import. The revision reverses that order.
- The contract describes operations that do not exist and a license that is wrong. The revision requires the contract to describe reality: either implement an operation in P1 or delete it.
- `notify-scheduler` and `parse-worker` are cron-driven functions outside the contract; that is acceptable and should be stated in the contract's description.

## 9. Current risks

- The `friend_connections` insert and update policies are a live information-disclosure path (section 5, item 1) on the public demo project. Fix before P1 by revoking direct table grants; the RPCs then replace them.
- The public demo and staging are the same project; `db push` on every merge to `main` can break the demo. Either separate them or add a manual approval to the deploy job.
- CORS `*` with bearer auth is tolerable; no CSP on the web app is not, given a public demo with real login.
- `planpal-sample.ics` at the repository root is gitignored and may hold real events; keep it out of commits.
- Dependabot PR #18 will break the Expo pin if merged.

## 10. Evidence gaps (in the order the revision closes them)

1. A friend can read a shared event; a friend cannot read a private event; a stranger sees nothing; a blocked user sees nothing; a revoked friend loses access immediately. None of these tests can exist today because the read path does not exist.
2. A contract with zero dead operations.
3. A recurrence test that generates cases and compares against an independent implementation.
4. A PlanPal event visible in the calendar the author already uses.
