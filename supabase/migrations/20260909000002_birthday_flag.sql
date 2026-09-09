-- Migration: replace the `__birthday__` colour sentinel with a protected flag
-- ---------------------------------------------------------------------------
-- `sync_birthday_event()` located its own row through
-- `color_label = '__birthday__'` — a user-visible, user-writable colour value.
-- The defect that produces is not visible by reading the function; it is
-- visible by running it:
--
--   PATCH /me {birthday: "1990-10-14"}                  -> 200
--   PATCH /events/<birthday id> {colorLabel:"#ff0000"}  -> 200
--   PATCH /me {birthday: "1990-11-02"}                  -> 200
--   GET /events -> TWO "Birthday" masters, one '#ff0000' (10-14) and one
--                  '__birthday__' (11-02)
--
-- Recolouring the master detaches it from the sentinel, so the next sync
-- cannot find it, orphans it, and inserts a second. The inverse is worse: a
-- user who sets `colorLabel: "__birthday__"` on any event has that event
-- deleted at their next birthday change.
--
-- `is_birthday` is a system-owned boolean instead. "System-owned" is made true
-- by a trigger rather than by convention — an end-user role that tries to set
-- it gets 42501, which `dbError` maps to 403.
--
-- FORWARD-ONLY ROLLBACK, in this order:
--   drop trigger events_protect_is_birthday on public.events;
--   drop function public.protect_is_birthday();
--   drop index events_one_birthday_per_owner;
--   create or replace function public.sync_birthday_event(p_user_id uuid) ...
--     restored to 20260614000001's `color_label = '__birthday__'` body;
--   update public.events set color_label = '__birthday__'
--    where is_birthday and is_master;          -- BEFORE the drop below
--   alter table public.events drop column is_birthday;
--
-- The backfill's DELETE below is destructive and not reversible, so be precise
-- about what it does and does not remove. Its WHERE clause is
-- `color_label = '__birthday__'`, so:
--
--   REMOVED: duplicate SENTINEL masters — all but the newest per owner. These
--            are unreachable rows the sentinel design produced.
--
--   LEFT IN PLACE: a RECOLOURED master. That is the primary artifact of the
--            defect this migration fixes — the user recoloured their birthday
--            event, it stopped matching the sentinel, and sync inserted a
--            second one. The recoloured row no longer matches the WHERE clause,
--            so it survives with `is_birthday = false` and becomes an ordinary,
--            unmanaged event the user still sees.
--
-- That is the deliberate choice: it is a row the user customised on purpose,
-- and deleting someone's event to tidy up our own bug is the worse trade. But
-- it means THIS MIGRATION DOES NOT LEAVE PROD CLEAN — expect a small number of
-- stray "Birthday" events, and expect users to delete them by hand. If that is
-- not acceptable, the cleanup wants its own migration and its own decision,
-- not a widened WHERE clause here.
--
-- On a shared environment take a backup first (docs/BOOTSTRAP.md step 5) —
-- and note that a `supabase db dump` is NOT a sufficient backup: it omits the
-- `on_auth_user_created` trigger. See docs/BOOTSTRAP.md § Backup and restore.
-- ---------------------------------------------------------------------------

alter table public.events add column is_birthday boolean not null default false;

-- Backfill. Keep the newest sentinel master per owner; the older ones are the
-- orphans the sentinel design produced.
with ranked as (
  select id, row_number() over (partition by owner_id order by created_at desc) as rn
    from public.events where is_master and color_label = '__birthday__')
delete from public.events where id in (select id from ranked where rn > 1);
update public.events set is_birthday = true, color_label = null
 where is_master and color_label = '__birthday__';

-- One birthday master per owner, enforced by the database rather than by the
-- function remembering to delete before it inserts.
create unique index events_one_birthday_per_owner
  on public.events (owner_id) where is_birthday and is_master;

-- The flag is system-owned. A plain request runs as `authenticated`; the
-- SECURITY DEFINER sync runs as the function owner. 42501 maps to 403 in
-- dbError.
--
-- `current_user in ('authenticated','anon')` is the guard, and it is the same
-- class of latent failure as a lock that only exists if a row matches: if a
-- future policy makes requests arrive as some other role, the protection
-- silently stops applying. The 42501 assertion in birthday.test.ts is what
-- would notice.
create or replace function public.protect_is_birthday() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.is_birthday is distinct from coalesce(old.is_birthday, false) then
    raise exception 'is_birthday is system-managed' using errcode = '42501';
  end if;
  return new;
end $$;

-- SECURITY INVOKER, so §15's revoke rule does not strictly bite — but
-- grants.test.ts's second assertion ("no function of ours executable by
-- PUBLIC, whatever its security mode") covers invoker functions too, and
-- Postgres grants EXECUTE to PUBLIC on every new function by default.
-- 20260908000001 is the precedent for revoking in the same migration.
revoke all on function public.protect_is_birthday() from public;
grant execute on function public.protect_is_birthday() to service_role;

create trigger events_protect_is_birthday before insert or update of is_birthday
  on public.events for each row execute function public.protect_is_birthday();

comment on column public.events.is_birthday is
  'System-managed. True on the single YEARLY master that sync_birthday_event '
  'maintains from public.users.birthday. Replaces the '
  '''__birthday__'' color_label sentinel, which was user-writable and so both '
  'orphaned the master when recoloured and deleted any event a user happened '
  'to colour with it. Writable only by roles other than authenticated/anon, '
  'enforced by events_protect_is_birthday.';

-- Same body as 20260614000001's sync_birthday_event, with two changes: the
-- DELETE finds the row by the flag, and the INSERT sets the flag instead of
-- the sentinel colour. Everything else is byte-identical, deliberately — this
-- migration is not the place to change birthday semantics.
create or replace function public.sync_birthday_event(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_birthday   date;
  v_timezone   text;
  v_start      timestamp;
  v_end        timestamp;
begin
  -- Read the user's current birthday and timezone.
  select birthday, timezone_id
    into v_birthday, v_timezone
    from public.users
   where id = p_user_id;

  -- Remove any pre-existing birthday master (cascade clears exceptions too).
  delete from public.events
   where owner_id = p_user_id
     and is_birthday
     and is_master = true;

  if v_birthday is null then
    return;  -- no birthday set; nothing to create
  end if;

  -- Build naive wall-clock timestamps for the birthday date.
  v_start := v_birthday::timestamp;               -- midnight
  v_end   := v_birthday::timestamp + interval '1 day' - interval '1 second'; -- 23:59:59

  insert into public.events (
    owner_id,
    title,
    local_start,
    local_end,
    timezone_id,
    is_master,
    recurrence_rule,
    visibility,
    is_birthday,
    color_label
  ) values (
    p_user_id,
    'Birthday',
    v_start,
    v_end,
    coalesce(v_timezone, 'UTC'),
    true,
    'FREQ=YEARLY',
    'private',
    true,
    null               -- the user's colour to choose; no sentinel to collide with
  );
end;
$$;

-- Restated rather than assumed: `create or replace function` leaves grants
-- alone, so these are already in force from 20260902000001. §15 wants the
-- migration to be self-describing about who may execute what.
revoke all on function public.sync_birthday_event(uuid) from public;
revoke all on function public.sync_birthday_event(uuid) from anon;
revoke all on function public.sync_birthday_event(uuid) from authenticated;
