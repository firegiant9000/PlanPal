-- Migration: record that utc_start/utc_end are an index approximation (AD-5)
-- ---------------------------------------------------------------------------
-- Problem
-- -------
-- Two independent derivations of the same instant exist and they are not
-- reconciled:
--
--   * `events_derive_utc()` uses Postgres `timestamp AT TIME ZONE <iana>`;
--   * `packages/recurrence` applies an explicit "compatible" policy — a
--     spring-forward GAP shifts FORWARD, a fall-back FOLD takes the EARLIER
--     instant — and ignores the stored column entirely.
--
-- Measured against the local stack (see supabase/tests/utc-authority.test.ts):
--
--   2026-03-08 02:30 America/New_York  (gap)   both -> 2026-03-08T07:30:00Z
--   2026-11-01 01:30 America/New_York  (fold)  engine -> 05:30:00Z (EDT)
--                                              Postgres -> 06:30:00Z (EST)
--
-- So they agree on the gap and differ by exactly one hour on the fold. (AD-5
-- anticipated a disagreement "twice a year"; the gap turns out not to be one of
-- them, because Postgres also resolves it forward.)
--
-- Decision
-- --------
-- Do NOT reimplement the engine's policy in PL/pgSQL. Maintaining one rule in
-- two languages is how M2 ended up with a duplicate RRULE walker, and the
-- second copy is always the one nobody tests.
--
-- Instead the authority is split, and stated here so it is discoverable from
-- the schema rather than only from a planning document:
--
--   * The ENGINE is authoritative for every user-visible instant. Responses
--     derive UTC per occurrence from local_* + timezone_id and never read
--     utc_start/utc_end.
--   * utc_start/utc_end are authoritative only for range scans (the
--     events_owner_utc_idx keyset) and conflict detection, where an hour of
--     slack on one night a year is immaterial: the row is still found, just at
--     the edge of a window.
--
-- Consequence: never return utc_start/utc_end to a client as the value of an
-- occurrence. `_shared/serialize.ts` does expose them on the Event model
-- because the contract defines them there, but they describe the MASTER row,
-- not any expanded occurrence — GET /occurrences derives its own.
--
-- Rollback: restore the previous comments; no data or behaviour changes here.
-- ---------------------------------------------------------------------------

comment on column public.events.utc_start is
  'INDEX APPROXIMATION, not a user-visible value. Derived from local_start + '
  'timezone_id by events_derive_utc() using Postgres AT TIME ZONE. The '
  'recurrence engine is authoritative for anything a user sees and re-derives '
  'UTC per occurrence, ignoring this column; the two differ by one hour for a '
  'local time inside a fall-back ambiguous hour (Postgres takes the later '
  'instant, the engine the earlier). Safe for range scans and conflict '
  'detection only. See AD-5.';

comment on column public.events.utc_end is
  'INDEX APPROXIMATION, not a user-visible value. See public.events.utc_start '
  'and AD-5: the recurrence engine is authoritative for user-visible instants '
  'and ignores this column.';

comment on function public.events_derive_utc() is
  'Maintains the utc_start/utc_end index approximation and bumps updated_at. '
  'Uses Postgres AT TIME ZONE, whose fall-back-fold resolution differs from '
  'the recurrence engine by one hour. Deliberately NOT reconciled — see AD-5 '
  'and the column comment on public.events.utc_start.';
