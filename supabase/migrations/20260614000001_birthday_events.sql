-- Migration: birthday auto-events (M2)
-- ---------------------------------------------------------------------------
-- Creates a YEARLY RRULE master event on the user's profile birthday whenever
-- a birthday is set or changed. Keeps exactly ONE birthday master event per
-- user. On birthday update the old master is deleted (cascade removes its
-- exceptions) and a new one is inserted.
--
-- Design:
--   * The event is owned by the user, Private by default (never shared).
--   * recurrence_rule = 'FREQ=YEARLY' — expands correctly across leap years
--     via the recurrence engine (Feb 29 → Feb 28 in non-leap years).
--   * local_start / local_end are set to midnight–midnight (all-day sentinel).
--     The API layer can detect the all-day flag by inspecting time components.
--   * timezone_id defaults to the user's profile timezone at creation time;
--     if the user later changes their timezone it intentionally stays pinned
--     to the original value (birthday is a wall-clock date, not an instant).
-- ---------------------------------------------------------------------------

-- Helper: upsert a birthday event for the given user.
-- Deletes any existing birthday master and inserts a fresh one if birthday
-- is not null; does nothing when birthday is null.
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
     and color_label = '__birthday__'
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
    '__birthday__'     -- sentinel so sync_birthday_event can find/replace it
  );
end;
$$;

-- Trigger: fires after INSERT or UPDATE on users when birthday changes.
create or replace function public.on_user_birthday_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Sync on insert (new profile) or when birthday column actually changed.
  if (TG_OP = 'INSERT') or (NEW.birthday is distinct from OLD.birthday) then
    perform public.sync_birthday_event(NEW.id);
  end if;
  return NEW;
end;
$$;

create trigger users_birthday_sync
  after insert or update of birthday on public.users
  for each row execute function public.on_user_birthday_change();
