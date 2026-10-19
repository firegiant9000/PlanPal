# @planpal/recurrence

Server-side **recurrence engine** — expands `events` (master-rule + sparse
exceptions) into concrete occurrences over a date range. This is the **Phase 4
kickoff** (docs/planning/MONTH_1_PLAN.md): a tested spike against the frozen Phase 2 schema.
**The client never expands rules** — expansion is server-side only.

## Usage

```ts
import { expandOccurrences, mapEventRow } from '@planpal/recurrence';

// In the future GET /occurrences endpoint (M2): fetch the caller's owned rows for
// the window (masters/standalone + any exception rows), then expand.
const records = rows.map(mapEventRow);
const occurrences = expandOccurrences(records, { from: '2026-06-08', to: '2026-06-14' });
// -> EventOccurrence[] (the OpenAPI `EventOccurrence` shape), sorted by utcStart.
```

The engine is **pure and synchronous** — no DB, no network. It re-derives
`utcStart`/`utcEnd` per occurrence from `local_*` + `timezone_id` (it ignores the
DB's stored `utc_*`), so DST shifts across a series are honored.

## Supported now

_Updated 2026-09-29 to match the code; the list below the kickoff heading was
written before Month 2 and had gone stale._

- `FREQ=DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` (incl. birthday auto-events)
- `INTERVAL` (e.g. bi-weekly = `WEEKLY;INTERVAL=2`)
- `BYDAY` weekday list (`MO,WE,FR`) and ordinals (`2MO`, `-1FR`)
- `BYMONTHDAY` (±1..31; an explicit `BYMONTHDAY=31` skips short months)
- `BYMONTH` (YEARLY only), `BYSETPOS`, `WKST`
- **Deliberate divergence, not yet documented as a decision:** MONTHLY and
  YEARLY rules with no `BY*` part _clamp_ a 29th–31st start to the last day of
  a short month (Jan 31 → Feb 28), where RFC 5545 skips the month. P3 decides
  this and records it here. Do not describe the engine as RFC 5545 compliant.
- `BYYEARDAY`, `BYWEEKNO`, `BYHOUR`, `BYMINUTE`, `EXDATE`/`RDATE` in the rule
  string: not supported (throw `UnsupportedRRuleError` where parsed)
- Edit scope: THIS only; THIS_AND_FOLLOWING is deferred
- `COUNT` and `UNTIL` end conditions — **counted from the series start**, not the
  query window, so a windowed view never miscounts a bounded series
- THIS-scope **overrides** (sparse: `null` field = inherit from master) and
  **cancellations** (`is_cancelled`)
- Standalone (non-recurring) events
- DST-correct UTC derivation via the runtime's built-in IANA data (`Intl`), no
  third-party tz library
- `from`/`to` window validated and capped at 180 days (matches the OpenAPI bound)
- Variable-schedule masters are intentionally **not** expanded (no concrete
  schedule until one is entered — M2 behavior)

Out-of-subset rules throw `UnsupportedRRuleError` (loud, never a silent drop).

## Status of the kickoff's "Completes in Month 2" list (2026-09-29)

- MONTHLY, YEARLY, `BYMONTHDAY`, `BYSETPOS`, `BYMONTH`, ordinal `BYDAY`, `WKST`:
  **done** (see above).
- DST gap and fold: handled and tested with fixed cases; the one-hour fold
  divergence from Postgres is documented as AD-5. Generated DST and leap-year
  cases are **P3**.
- `rrule` + `luxon` decision: **decided** — the runtime engine stays
  hand-rolled and zero-dependency. `rrule` (rrule.js) and `fast-check` enter
  only as **dev dependencies of this package**, as the independent oracle and
  generator for the P3 differential tests.
- `GET /occurrences`: **done**. `GET /friends/{userId}/occurrences` with
  server-side `sensitive_public` redaction: **P1** (not built).

Milestones P1 and P3 are in
[docs/planning/DEVELOPMENT_PLAN.md](../../docs/planning/DEVELOPMENT_PLAN.md).

## Tests

Zero-dependency `node:test` suites (`*.test.ts`), compiled by `tsc`:

```bash
pnpm --filter @planpal/recurrence test
```

Covers the timezone conversion, the RRULE subset/iterator (incl. COUNT-from-start),
and the full seed scenario (master + override + cancel + standalone). The suite
is 57 hand-written cases with enforced coverage floors (90 % lines, 85 %
branches, 90 % functions) and runs in CI. It has no generated or property-based
cases yet; that is P3.
