# @planpal/recurrence

Server-side **recurrence engine** — expands `events` (master-rule + sparse
exceptions) into concrete occurrences over a date range. This is the **Phase 4
kickoff** (MONTH_1_PLAN.md): a tested spike against the frozen Phase 2 schema.
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

## Supported now (kickoff subset)

Enough to expand real weekly / bi-weekly / custom-day schedules:

- `FREQ=DAILY` and `FREQ=WEEKLY`
- `INTERVAL` (e.g. bi-weekly = `WEEKLY;INTERVAL=2`)
- `BYDAY` weekday list (`MO,WE,FR`)
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

## Completes in Month 2 (NOT in this kickoff)

- `FREQ=MONTHLY` / `FREQ=YEARLY` (incl. birthday auto-events), `BYMONTHDAY`,
  `BYSETPOS`, `BYMONTH`, ordinal `BYDAY` (`2MO`), non-`MO` `WKST`
- Exhaustive **DST gap / ambiguous-hour** resolution and **leap-year** edge tests
  (see `timezone.ts` — ordinary transitions work; the two pathological wall-clock
  cases are not yet special-cased)
- Decision (needs team approval — locked-stack rule): adopt `rrule` + `luxon`, or
  keep the hand-rolled zero-dep engine and extend it
- The `GET /occurrences` / `GET /friends/{userId}/occurrences` endpoints that call
  this engine (the friends path adds server-side `sensitive_public` redaction)

## Tests

Zero-dependency `node:test` suites (`*.test.ts`), compiled by `tsc`:

```bash
pnpm --filter @planpal/recurrence test
```

Covers the timezone conversion, the RRULE subset/iterator (incl. COUNT-from-start),
and the full seed scenario (master + override + cancel + standalone). The plan
marks the recurrence engine as a **mandatory high-coverage area**; Phase 3 wires
this suite into CI.
