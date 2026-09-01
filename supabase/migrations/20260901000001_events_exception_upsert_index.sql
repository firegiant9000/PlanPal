-- Migration: make the one-exception-per-date index usable as an ON CONFLICT target
-- ---------------------------------------------------------------------------
-- Problem
-- -------
-- `events_one_exception_per_date` (core_schema.sql) is a PARTIAL unique index:
--
--   create unique index events_one_exception_per_date
--     on public.events (master_event_id, recurrence_exception_date)
--     where master_event_id is not null;
--
-- Postgres will only infer a partial index for `ON CONFLICT (cols)` when the
-- statement repeats the index predicate. PostgREST's upsert cannot express a
-- predicate, so every
--   PUT    /events/:id/occurrences/:date   (THIS-override)
--   DELETE /events/:id/occurrences/:date   (THIS-cancel)
-- failed at runtime with:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Fix
-- ---
-- Drop the predicate. The index stays correct for master/standalone rows
-- because Postgres treats NULLs as distinct in unique indexes by default
-- (NULLS DISTINCT), so the unlimited master rows — which all have
-- master_event_id = null — never collide with one another.
--
-- `events_shape_ck` already guarantees an exception row has BOTH
-- master_event_id and recurrence_exception_date set, so no exception row can
-- sneak in with a null half.
--
-- Rollback: recreate the index with the `where master_event_id is not null`
-- predicate; no data migration is required in either direction.
-- ---------------------------------------------------------------------------

drop index if exists public.events_one_exception_per_date;

create unique index events_one_exception_per_date
  on public.events (master_event_id, recurrence_exception_date);

comment on index public.events_one_exception_per_date is
  'One exception row per (master, occurrence date). Deliberately NOT partial so '
  'PostgREST upserts can use it as an ON CONFLICT target; master rows carry a '
  'null master_event_id and are NULLS DISTINCT, so they never conflict.';
