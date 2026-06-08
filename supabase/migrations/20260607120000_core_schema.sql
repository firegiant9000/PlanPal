-- Migration: core domain schema (Phase 2) — HIGHEST RISK, both-dev review required
-- ---------------------------------------------------------------------------
-- Scope: the load-bearing data model — users, notification_preferences,
-- devices, events (master-rule + exceptions), friend_codes, friend_connections.
-- Shapes are derived from and MUST stay aligned with the frozen Phase 1 contract
-- (packages/api-contract/openapi.yaml) and @planpal/types enums.
--
-- Design notes (see MONTH_1_PLAN.md Phase 2 + the OpenAPI "Conventions" block):
--   * Timezone: local_start/local_end (naive wall-clock) + timezone_id (IANA) is
--     the source of truth. utc_start/utc_end are DERIVED by trigger and used for
--     indexing + conflict detection. Clients never compute UTC.
--   * Recurrence: master-rule + exceptions, NO pre-generated instances. A row is
--     either a master/standalone (is_master) carrying the RRULE, or a sparse
--     exception row (master_event_id + recurrence_exception_date) holding only the
--     fields that differ; a cancelled occurrence is an exception with is_cancelled.
--   * Privacy is zero-tolerance: every table opts back in to grants + RLS on top of
--     the Phase 0 deny-by-default posture. events stay OWNER-ONLY at the row level;
--     friend visibility + sensitive_public redaction are served by a future
--     SECURITY DEFINER RPC at query time, never by broad row exposure.
--   * friend_connections is the whole friend graph: pending = a friend request,
--     accepted = a friendship, blocked = a block. Direction (incoming/outgoing) is
--     derived from requester_id/addressee_id at read time.
--
-- Rollback: forward-only project. The reversal for this migration is a single
-- DROP block (drop the tables — cascades take the triggers/policies/indexes — then
-- the two enum types, then the handle_new_user trigger on auth.users). The full
-- runbook lives in docs/BOOTSTRAP.md ("Database migration strategy"). Test the
-- reversal against staging before prod.
-- ---------------------------------------------------------------------------

-- 0. Extensions --------------------------------------------------------------
create extension if not exists citext;      -- case-insensitive usernames
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- 1. Enum types (mirror @planpal/types/enums.ts) -----------------------------
create type public.visibility as enum (
  'private', 'shared_all', 'shared_select', 'sensitive_public'
);
create type public.friend_connection_status as enum (
  'pending', 'accepted', 'blocked'
);

-- 2. Shared trigger helpers --------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 3. users (profile) ---------------------------------------------------------
-- 1:1 with auth.users. Maps to the OpenAPI `Profile` schema.
create table public.users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  username           citext not null unique
                       check (char_length(username) between 3 and 30),
  display_name       text not null
                       check (char_length(display_name) between 1 and 80),
  avatar_url         text,
  birthday           date,
  default_visibility public.visibility not null default 'private',
  timezone_id        text not null default 'UTC',
  -- last_active is opt-in (off by default); the value is only ever exposed to
  -- friends when last_active_opt_in is true (enforced in the friends RPC later).
  last_active_opt_in boolean not null default false,
  last_active_at     timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- 4. notification_preferences ------------------------------------------------
-- 1:1 with users. Maps to OpenAPI `NotificationPreference`. Blocks the M2
-- notification scheduler (see the dependency table in MONTH_1_PLAN.md).
create table public.notification_preferences (
  user_id            uuid primary key references public.users (id) on delete cascade,
  -- minutes-before-start reminder lead times; contract bounds each 0..40320 (28d).
  lead_times_minutes integer[] not null default '{10,60}'
                       check (0 <= all(lead_times_minutes)
                              and 40320 >= all(lead_times_minutes)),
  push_enabled       boolean not null default true,
  -- local "HH:mm" do-not-disturb window; null = no quiet hours.
  quiet_hours_start  time,
  quiet_hours_end    time,
  updated_at         timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- 5. devices (Expo push tokens) ----------------------------------------------
-- Maps to OpenAPI `Device`; idempotent on the token (it is the PK).
create table public.devices (
  expo_push_token text primary key,
  user_id         uuid not null references public.users (id) on delete cascade,
  platform        text not null check (platform in ('ios', 'android', 'web')),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index devices_user_id_idx on public.devices (user_id);

-- 6. events (master-rule + exceptions) ⚠️ the highest-risk table -------------
-- A row is one of two shapes, enforced by events_shape_ck below:
--   MASTER / STANDALONE : is_master = true,  master_event_id is null,
--                         recurrence_exception_date is null. Carries the full
--                         definition; recurrence_rule is null for standalone.
--   EXCEPTION           : is_master = false, master_event_id + exception_date set.
--                         A SPARSE override — null inheritable columns mean
--                         "inherit from the master". is_cancelled = true removes
--                         that one occurrence from expansion (the THIS-cancel path).
create table public.events (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null references public.users (id) on delete cascade,

  -- Inheritable content (required on masters, null = inherit on exceptions).
  title                     text     check (char_length(title) <= 200),
  description               text     check (char_length(description) <= 2000),
  location                  text     check (char_length(location) <= 300),

  -- Timezone source of truth (naive wall-clock + IANA zone).
  local_start               timestamp,
  local_end                 timestamp,
  timezone_id               text,
  -- Derived (read-only to clients) by events_derive_utc(); for indexing/conflicts.
  utc_start                 timestamptz,
  utc_end                   timestamptz,

  -- Recurrence model.
  is_master                 boolean not null default true,
  master_event_id           uuid references public.events (id) on delete cascade,
  recurrence_rule           text,            -- RFC 5545 RRULE; masters only
  recurrence_exception_date date,            -- the overridden occurrence's date
  is_cancelled              boolean not null default false,
  is_variable_schedule      boolean not null default false,

  -- Sharing.
  visibility                public.visibility,
  shared_with               uuid[] not null default '{}',  -- used by shared_select
  color_label               text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- Exactly one of the two row shapes.
  constraint events_shape_ck check (
    (is_master
       and master_event_id is null
       and recurrence_exception_date is null
       and is_cancelled = false)
    or
    (is_master = false
       and master_event_id is not null
       and recurrence_exception_date is not null)
  ),
  -- Masters/standalone carry the full required definition (exceptions may inherit).
  constraint events_master_fields_ck check (
    is_master = false
    or (title is not null
        and local_start is not null
        and local_end is not null
        and timezone_id is not null
        and visibility is not null)
  ),
  -- Only masters define a recurrence rule.
  constraint events_rule_master_only_ck check (is_master or recurrence_rule is null),
  -- End strictly after start whenever both are present.
  constraint events_time_order_ck check (
    local_start is null or local_end is null or local_end > local_start
  )
);

-- One exception row per (master, occurrence date).
create unique index events_one_exception_per_date
  on public.events (master_event_id, recurrence_exception_date)
  where master_event_id is not null;

-- Owner listing + range/conflict scans on the derived UTC bounds.
create index events_owner_idx          on public.events (owner_id);
create index events_owner_utc_idx      on public.events (owner_id, utc_start, utc_end);
create index events_master_idx         on public.events (master_event_id)
  where master_event_id is not null;
-- "events shared with me" lookups for the (future) friends view.
create index events_shared_with_gin    on public.events using gin (shared_with);

comment on column public.events.local_start is
  'Naive wall-clock start, interpreted in timezone_id. Source of truth with timezone_id.';
comment on column public.events.utc_start is
  'DERIVED from local_start + timezone_id by events_derive_utc(). Read-only to clients.';
comment on column public.events.master_event_id is
  'Null on masters/standalone; on exception rows points at the master being overridden.';
comment on column public.events.is_cancelled is
  'Exception rows only: true removes that single occurrence from expansion (THIS-cancel).';

-- Derive utc_start/utc_end from the local time + zone, and bump updated_at.
-- `timestamp AT TIME ZONE <iana>` interprets the naive value as wall-clock in that
-- zone and yields the UTC instant; an invalid zone raises here (implicit validation).
-- NOTE: DST gap/ambiguous-hour edge cases use Postgres' default resolution; full
-- DST/leap handling is finished with the recurrence engine in Month 2.
create or replace function public.events_derive_utc()
returns trigger language plpgsql as $$
begin
  if new.local_start is not null and new.timezone_id is not null then
    new.utc_start := new.local_start at time zone new.timezone_id;
    new.utc_end   := new.local_end   at time zone new.timezone_id;
  else
    new.utc_start := null;
    new.utc_end   := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger events_derive_utc_trigger
  before insert or update on public.events
  for each row execute function public.events_derive_utc();

-- 7. friend_codes ------------------------------------------------------------
-- One ACTIVE code per user (expires_at is null). Rotation issues a new active row
-- and stamps the old one's expires_at 30 days out. Maps to OpenAPI `FriendCode`.
create table public.friend_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users (id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  expires_at timestamptz,            -- null while active
  created_at timestamptz not null default now()
);
create unique index friend_codes_one_active_per_user
  on public.friend_codes (user_id)
  where expires_at is null;

-- Generate a unique 8-char A-Z0-9 friend code (retries on the rare collision).
create or replace function public.generate_friend_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  result text;
  i int;
begin
  loop
    result := '';
    for i in 1..8 loop
      result := result || substr(alphabet, 1 + floor(random() * 36)::int, 1);
    end loop;
    exit when not exists (select 1 from public.friend_codes where code = result);
  end loop;
  return result;
end;
$$;

-- 8. friend_connections (the whole friend graph) -----------------------------
-- pending = a friend request (requester -> addressee), accepted = a friendship,
-- blocked = a block (requester_id is the blocker). Direction is derived at read
-- time. Maps to OpenAPI `FriendConnection`/`FriendRequest` and the block endpoint.
create table public.friend_connections (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users (id) on delete cascade,
  addressee_id uuid not null references public.users (id) on delete cascade,
  status       public.friend_connection_status not null default 'pending',
  accepted_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint friend_connections_not_self_ck check (requester_id <> addressee_id)
);
-- At most one connection per unordered pair, regardless of who initiated.
create unique index friend_connections_unique_pair
  on public.friend_connections (least(requester_id, addressee_id),
                                greatest(requester_id, addressee_id));
create index friend_connections_requester_idx on public.friend_connections (requester_id);
create index friend_connections_addressee_idx on public.friend_connections (addressee_id);

create trigger friend_connections_set_updated_at
  before update on public.friend_connections
  for each row execute function public.set_updated_at();

-- 9. New-user bootstrap ------------------------------------------------------
-- On auth signup, materialize the public profile + default notification prefs +
-- an initial active friend code so GET /me and the friends flow work immediately.
-- SECURITY DEFINER so it runs as the table owner (bypasses RLS during signup).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  generated_username text := 'user_' || left(replace(new.id::text, '-', ''), 12);
begin
  insert into public.users (id, username, display_name, timezone_id)
  values (
    new.id,
    generated_username,
    coalesce(new.raw_user_meta_data ->> 'display_name', generated_username),
    coalesce(new.raw_user_meta_data ->> 'timezone_id', 'UTC')
  );

  insert into public.notification_preferences (user_id) values (new.id);

  insert into public.friend_codes (user_id, code)
  values (new.id, public.generate_friend_code());

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 10. Row-Level Security -----------------------------------------------------
-- Phase 0 revoked blanket grants (deny by default). Opt each table back in with
-- the narrowest grants, then constrain rows with RLS. Cross-user reads (a friend's
-- redacted calendar, friend lookup by code) are intentionally NOT exposed here —
-- they will be served by SECURITY DEFINER RPCs so a compromised client can never
-- pull hidden columns.

-- users: read self + accepted friends (for friend summaries); write only self.
alter table public.users enable row level security;
grant select, insert, update, delete on public.users to authenticated;

create policy users_select_self_or_friends on public.users
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.friend_connections fc
      where fc.status = 'accepted'
        and ((fc.requester_id = auth.uid() and fc.addressee_id = public.users.id)
          or (fc.addressee_id = auth.uid() and fc.requester_id = public.users.id))
    )
  );
create policy users_insert_self on public.users
  for insert to authenticated with check (id = auth.uid());
create policy users_update_self on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy users_delete_self on public.users
  for delete to authenticated using (id = auth.uid());

-- notification_preferences: owner only.
alter table public.notification_preferences enable row level security;
grant select, insert, update, delete on public.notification_preferences to authenticated;
create policy notif_prefs_owner_all on public.notification_preferences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- devices: owner only.
alter table public.devices enable row level security;
grant select, insert, update, delete on public.devices to authenticated;
create policy devices_owner_all on public.devices
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- events: OWNER ONLY at the row level. Friend visibility + sensitive_public
-- redaction are served by a future SECURITY DEFINER RPC, never by RLS exposure.
alter table public.events enable row level security;
grant select, insert, update, delete on public.events to authenticated;
create policy events_owner_all on public.events
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- friend_codes: owner reads/manages own codes. Lookup of OTHERS' codes (to send a
-- request) is via a SECURITY DEFINER RPC only — no row exposure (anti-enumeration).
alter table public.friend_codes enable row level security;
grant select, insert, update, delete on public.friend_codes to authenticated;
create policy friend_codes_owner_all on public.friend_codes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- friend_connections: either party can read/act on a connection. Creating a
-- request requires requester_id = self (the addressee is resolved from a code by
-- the future RPC, which runs as definer).
alter table public.friend_connections enable row level security;
grant select, insert, update, delete on public.friend_connections to authenticated;
create policy friend_conn_select_party on public.friend_connections
  for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy friend_conn_insert_requester on public.friend_connections
  for insert to authenticated with check (requester_id = auth.uid());
create policy friend_conn_update_party on public.friend_connections
  for update to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid())
  with check (requester_id = auth.uid() or addressee_id = auth.uid());
create policy friend_conn_delete_party on public.friend_connections
  for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
