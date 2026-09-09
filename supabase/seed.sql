-- Local seed data, applied on `supabase db reset`. LOCAL DEV ONLY.
--
-- Phase 2: now that the core schema exists, seed a usable local stack. Two test
-- users (the on_auth_user_created trigger auto-creates their profile, notification
-- prefs, and an initial friend code), an accepted friendship between them, and a
-- few events incl. a recurring master + a single-occurrence exception.
--
-- Test logins (local Inbucket / password): alice@example.com / scott@example.com,
-- password "password123".

-- 1. Auth users (the trigger fans out into public.users / prefs / friend_codes) --
--
-- confirmation_token, recovery_token, email_change_token_new and email_change
-- are set to '' deliberately. They are the only string columns on auth.users
-- with no database default, so a direct insert leaves them NULL — and GoTrue
-- scans them into non-nullable Go strings, so every sign-in as these accounts
-- failed with 500 "Database error querying schema":
--
--   Scan error on column index 3, name "confirmation_token":
--   converting NULL to string is unsupported
--
-- The integration suite never caught it because harness.ts creates its users
-- through the admin API instead of inserting rows.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'alice@example.com', crypt('password123', gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}',
   '{"display_name":"Alice Example","timezone_id":"America/New_York"}',
   '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'scott@example.com', crypt('password123', gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}',
   '{"display_name":"Scott Example","timezone_id":"America/Los_Angeles"}',
   '', '', '', '')
on conflict (id) do nothing;

-- 2. Friendly usernames on top of the trigger-generated defaults ----------------
update public.users set username = 'alice', default_visibility = 'shared_all'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set username = 'scott'
  where id = '22222222-2222-2222-2222-222222222222';

-- 3. An accepted friendship -----------------------------------------------------
insert into public.friend_connections
  (requester_id, addressee_id, status, accepted_at)
values
  ('11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222', 'accepted', now())
on conflict do nothing;

-- 4. Events (utc_start/utc_end derived by trigger) ------------------------------
-- A standalone event.
insert into public.events
  (id, owner_id, title, description, local_start, local_end, timezone_id, visibility)
values
  ('aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   'Coffee with Scott', 'Catch-up',
   '2026-06-10T09:00:00', '2026-06-10T10:00:00', 'America/New_York', 'shared_all');

-- A weekly recurring master + one overridden occurrence (THIS-scope exception).
insert into public.events
  (id, owner_id, title, local_start, local_end, timezone_id, recurrence_rule, visibility)
values
  ('aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   'Standup', '2026-06-08T09:30:00', '2026-06-08T09:45:00',
   'America/New_York', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'private');

-- Override the 2026-06-10 occurrence (later + renamed); inherits everything else.
insert into public.events
  (owner_id, is_master, master_event_id, recurrence_exception_date,
   title, local_start, local_end, timezone_id)
values
  ('11111111-1111-1111-1111-111111111111', false,
   'aaaaaaaa-0000-0000-0000-000000000002', '2026-06-10',
   'Standup (moved)', '2026-06-10T10:00:00', '2026-06-10T10:15:00', 'America/New_York');

-- Cancel the 2026-06-12 occurrence (sparse exception row, is_cancelled).
insert into public.events
  (owner_id, is_master, master_event_id, recurrence_exception_date, is_cancelled)
values
  ('11111111-1111-1111-1111-111111111111', false,
   'aaaaaaaa-0000-0000-0000-000000000002', '2026-06-12', true);
