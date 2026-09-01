-- Migration: notification scheduler — security + recurrence correctness
-- ---------------------------------------------------------------------------
-- Fixes three defects in 20260614000002_notification_scheduler.sql.
--
-- 1. PRIVACY HOLE (critical)
--    `get_pending_notifications()` and `record_notification_sent()` were
--    SECURITY DEFINER with the default EXECUTE grant to PUBLIC. Any signed-in
--    user could call:
--        select * from get_pending_notifications(now());
--    and read EVERY user's event titles, owner ids and Expo push tokens,
--    straight through RLS. `record_notification_sent()` was equally open, so a
--    caller could forge send-records and silently suppress other people's
--    reminders.
--
--    Both functions are dropped. The scheduler Edge Function holds the service
--    role key and queries the tables directly, so no SECURITY DEFINER surface
--    needs to exist at all.
--
-- 2. RECURRING EVENTS NEVER FIRED (critical)
--    The old query matched on `events.utc_start`, which on a master row is the
--    FIRST occurrence only. A weekly event notified once, ever. Occurrence
--    expansion now happens in the Edge Function via the shared
--    `packages/recurrence` engine — the single tested implementation — rather
--    than being re-implemented a third time in PL/pgSQL.
--
--    That makes the dedupe key per-occurrence: `notification_sends` gains
--    `occurrence_date`, without which the second occurrence of any series
--    would be suppressed as a duplicate of the first.
--
-- 3. UNBOUNDED GROWTH
--    `notification_sends` had no retention. It grows by
--    (events x devices x lead times) forever. A cleanup function is added and
--    the scheduler calls it opportunistically.
--
-- Rollback: see docs/BOOTSTRAP.md. Re-creating the two dropped functions
-- restores the old behaviour, but do not do so without adding
--   revoke execute on function ... from public, anon, authenticated;
-- ---------------------------------------------------------------------------

-- 1. Remove the SECURITY DEFINER surface -------------------------------------
drop function if exists public.get_pending_notifications(timestamptz);
drop function if exists public.record_notification_sent(uuid, text, integer);

-- 2. Per-occurrence dedupe ---------------------------------------------------
-- Backfill uses the send date, which is the best available approximation for
-- any pre-existing row (there are none in a deployed environment yet — the
-- staging deploy has never run — but the migration must not assume that).
alter table public.notification_sends
  add column if not exists occurrence_date date;

update public.notification_sends
   set occurrence_date = (sent_at at time zone 'UTC')::date
 where occurrence_date is null;

alter table public.notification_sends
  alter column occurrence_date set not null;

alter table public.notification_sends
  drop constraint if exists notification_sends_unique;

alter table public.notification_sends
  add constraint notification_sends_unique
  unique (event_id, occurrence_date, expo_push_token, lead_time_minutes);

comment on column public.notification_sends.occurrence_date is
  'The specific occurrence this send was for. Part of the dedupe key: without '
  'it, only the first occurrence of a recurring series would ever notify.';

-- 3. Retention ---------------------------------------------------------------
create index if not exists notification_sends_sent_at_idx
  on public.notification_sends (sent_at);

-- Send records only exist to suppress double-fires. Once an occurrence is well
-- in the past there is nothing left to suppress.
create or replace function public.prune_notification_sends(p_keep_days integer default 7)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_deleted integer;
begin
  delete from public.notification_sends
   where sent_at < now() - make_interval(days => p_keep_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- SECURITY DEFINER functions are granted to PUBLIC by default. Lock this one
-- to the service role; nothing user-facing should ever call it.
revoke all on function public.prune_notification_sends(integer) from public;
revoke all on function public.prune_notification_sends(integer) from anon;
revoke all on function public.prune_notification_sends(integer) from authenticated;
grant execute on function public.prune_notification_sends(integer) to service_role;

-- 4. Belt-and-braces on the table itself -------------------------------------
-- RLS is already enabled with no policies (service-role only), but the default
-- table grants to anon/authenticated still exist in a stock Supabase project.
revoke all on table public.notification_sends from anon;
revoke all on table public.notification_sends from authenticated;
