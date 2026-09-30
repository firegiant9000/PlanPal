# MVP exit gate — evidence log

The gate in [MONTH_3_4_PLAN.md](planning/MONTH_3_4_PLAN.md) says **"evidence required … not a
self-assessment"**. This file exists to hold artefacts, not ticks. A criterion is
green only when something reproducible is pasted under it.

**Status of this document:** started 2026-09-08. Criteria 1, 2 and 7 carry real
evidence; 3–6 are open and say why. Nothing here is marked green on the strength
of an intention.

**Mapping to the 2026-09-29 revision** ([planning/DEVELOPMENT_PLAN.md](planning/DEVELOPMENT_PLAN.md)):
criterion 2's property half is P3; criterion 3 (push on a device) is OPTIONAL;
criterion 4 (14-day dogfood) is re-scoped to one user and becomes P4's
acceptance; criterion 5 (ten users) is SUPERSEDED; criterion 6's leakage half
is P2; criterion 7 is redone once with populated tables after P1. This log
stays the place where the evidence is pasted.

---

## 1. Event CRUD is stable

**Evidence required:** the integration suite green, plus an empty critical/high
CRUD defect queue.

**Suite — green, 2026-09-08:**

```
pnpm test:integration
Test Files  15 passed (15)
     Tests  215 passed | 1 skipped (216)
```

Covering `events`, `occurrences`, `devices`, `friend-code`, `rls`, `grants`,
`utc-authority`, `export-ical`, `birthday`, `healthz`, `notify-scheduler`,
`contract-shape`, `api-client`, `me`, `auth-flow`.

**Defect queue — NOT ASSESSED.** PR #3 listed 13 defects. Several are fixed on
this branch (the friend-code rotation lock, the birthday sentinel, the
occurrence-override atomicity, the one-off export exception), but no one has
walked the list and confirmed the critical/high set is empty. **This criterion
is not closable until that walk happens.**

---

## 2. Recurrence edge cases hold

**Evidence required:** the engine suite green at ≥ 90 %, **and** the §P11 manual
DST / leap-year / month-rollover checklist signed.

**Engine suite — green, 2026-09-08, above its enforced bar (lines ≥ 90,
branches ≥ 85, functions ≥ 90):**

```
pnpm --filter @planpal/recurrence test
# tests 57
# pass 57
all files  |  95.61 |    90.44 |   95.24 |
```

**§P11 manual checklist — NOT DONE.** The automated suite covers DST boundaries
in its own fixtures, but the manual checklist is a separate artefact and it has
not been walked or signed. **Criterion 2 is half-evidenced.**

---

## 3. Push works on real devices

**Evidence required:** a **recurring**-event reminder received on a physical
Android **and** iOS device with the app backgrounded.

**NOT PROVEN, and the gap is precise.** What is proven is everything up to
delivery:

- The `pg_cron` schedule fires on `planpal-dev` — 11 consecutive minutes of
  `200` from `net._http_response`, 01:08Z–01:18Z on 2026-09-09, body
  `{"dispatched":0,"candidates":0}`.
- The gateway and the secret check both behave: no `Authorization` → `401`,
  correct auth → `200`, wrong `X-Cron-Secret` → `403`.

**What is missing is layer 3** — a `notification_sends` row for a real device.
It cannot be produced here: Expo answers `DeviceNotRegistered` for a fake token
and the `devices` row is pruned. It needs a real Expo push token from a
dev-client build (T25-Android), **which is blocked on decision D-I** (does each
dev have an Android handset?), unanswered as of 2026-09-08.

**iOS is Apple-blocked** pending T3 — see § Known limits.

---

## 4. Both devs used it daily for ≥ 2 weeks

**Evidence required:** a 14-day dogfood log with entries from both devs.

**NOT STARTED.** This is calendar time, not engineering time: 14 **consecutive**
days have to fit between the installable build and the gate, so the build is the
real constraint. It depends on T25-Android, which is D-I-blocked.

---

## 5. Ten real users tested

**Evidence required:** session notes, one per user.

**NOT STARTED.** Recruiting is **lead time, not engineering time** and should
already be under way — especially for testers with variable-schedule jobs, who
are the users the variable-schedule feature exists for.

---

## 6. All critical and high defects fixed

**Evidence required:** an empty critical/high queue, with mediums written up as
a known-issues list.

**NOT ASSESSED.** See criterion 1. In addition, these were found during M3/M4
implementation and are recorded in code but not triaged into the queue:

- The contract declares seven `Event` properties non-nullable that the schema
  permits to be NULL, plus `Profile.birthday` and `Device.platform`.
  `toEventModel` throws rather than emitting a null through a non-nullable
  field. Real fix is a `NOT NULL` migration or a contract change (two-dev, §15).
- `GET /events/{id}` does not filter `is_master`, so an exception row's id would
  serialise through the `Event` shape.
- `/healthz` hangs rather than returning 503 when Postgres is reachable but
  wedged — an uptime checker sees a timeout, not a 503.
- `apps/mobile` bundle grew 2.53 MB → 6.34 MB across M3/M4 (api-client,
  supabase-js, secure-store, notifications, Sentry, PostHog, AsyncStorage).
  Not a defect, but it is a startup-time and download-size question nobody has
  answered.

---

## 7. Backups are restorable

**Evidence required:** a completed, **dated** test restore.

**REHEARSAL COMPLETE — 2026-09-08 — but it produced two findings that stop this
being a clean pass.**

| Field            | Value                                                          |
| ---------------- | -------------------------------------------------------------- |
| Source           | `planpal-dev` (`dhsfivkumctnstziokmu`), Postgres 17.6.1.166    |
| Duration         | 7m07s wall clock (00:11:45Z → 00:18:52Z)                       |
| Structural check | 7/7 tables, RLS on all 7, 12 policies — matched dev exactly    |
| `grants.test.ts` | 20/21 on first load → **21/21** after re-attaching the trigger |

**Finding A — `supabase db dump` is not a backup.** It omits the
`on_auth_user_created` trigger (the trigger lives on `auth.users`, which the
dump excludes). A restored database accepts signups that silently create no
`users` / `notification_preferences` / `friend_codes` rows. Confirmed by
control: present on both local and dev, absent after restore.

**Finding B — `planpal-dev` has no automated backups.**
`supabase backups list` returns `"pitr_enabled": false, "backups": []`.

**Consequence:** criterion 7's evidence exists, but the thing being evidenced is
a manual dump that is provably incomplete. **`planpal-prod` needs a tier with
daily automated backups before external testers are admitted.** Full procedure
and manual steps: [BOOTSTRAP.md](BOOTSTRAP.md#backup-and-restore).

**Also unproven:** the data path. Every public table on dev is empty, so the
restore's row-count comparison was 0 = 0 and demonstrates nothing about data.

---

## Known limits of this gate

Recorded so the Beta privacy QA pass does not assume they were covered:

1. **Cross-user visibility leakage cannot be tested before M6.** There is no
   friend graph yet, so no test can demonstrate that one user's private or
   sensitive-public events stay invisible to another. Friend-visibility and
   sensitive-public redaction are deferred to `SECURITY DEFINER` RPCs that do
   not exist yet. Anything the apps do today for `sensitive_public` is
   **presentation in the owner's own view**, not enforcement.
   _Correction 2026-09-29:_ the `friend_connections` table and its policies
   already existed and were directly writable by `authenticated`, so a
   cross-user test was possible. It was written and the writes were closed on
   2026-09-30 (PR #19; P0 in
   [planning/DEVELOPMENT_PLAN.md](planning/DEVELOPMENT_PLAN.md)). The full
   isolation suite is P2, which also closes criterion 6's leakage half.
2. **iOS push and TestFlight are Apple-blocked** pending T3. Criterion 3's iOS
   half cannot be satisfied until an Apple Developer account exists.

---

## Open decisions blocking this log

| ID          | Question                            | Status as of 2026-09-08                                                                                                                                                                                                         |
| ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-I**     | A physical Android phone per dev?   | **"Unsure"** — blocks T25-Android and T26-FCM, and therefore criteria 3 and 4. A phone is the only way to close #3: Expo returns `DeviceNotRegistered` for a fake token, so neither an emulator nor Expo Go can prove delivery. |
| **Descope** | What gives if Arlo's line overruns? | **Moot** — T24, H2, T29 and T28 are all built, so there is nothing left to cut.                                                                                                                                                 |

**D-0, the week anchor, has been deleted** along with the whole week schedule
(2026-09-08). The plan is now ordered by dependency and estimated in ideal days,
with no start dates and no deadlines — so there are no wk-13/wk-14 conditions
left to judge. What replaces them is the two milestone conditions at the top of
`planning/M3_M4_IMPLEMENTATION_PLAN.md`, and the constraint that actually binds: the
14-day dogfood window needs consecutive calendar days and cannot begin before
there are builds to dogfood.
