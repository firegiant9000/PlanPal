-- Demo seed for the public demo project. NOT applied by `supabase db reset`
-- (that runs seed.sql); applied explicitly, and nightly by
-- .github/workflows/reseed-demo.yml.
--
-- Every date is relative to now(), because the demo's whole job is that a
-- visitor lands on a POPULATED calendar. A fixed-date seed goes stale and
-- shows an empty month.
--
-- Anchor: date_trunc('week', now()) is Monday 00:00 of the current ISO week.
-- The recurring master below is FREQ=WEEKLY;BYDAY=MO,WE,FR, so the exception
-- dates must be that Monday + 2 (Wednesday) and + 4 (Friday) to land on real
-- occurrences.
--
-- Published credentials: demo@planpal.app / planpal-demo

begin;

-- Idempotent: the nightly reseed re-runs this over an edited demo account.
delete from public.events where owner_id = '33333333-3333-3333-3333-333333333333';
delete from auth.users where id = '33333333-3333-3333-3333-333333333333';

-- 1. The demo account. email_confirmed_at is set at insert so no confirmation
--    email is needed — hosted SMTP on the free tier could not deliver one
--    reliably anyway (specs §2.6).
--
--    confirmation_token, recovery_token, email_change_token_new and
--    email_change are set to '' deliberately. They are the only string columns
--    on auth.users with no database default, so a direct insert leaves them
--    NULL — and GoTrue scans them into non-nullable Go strings, failing every
--    sign-in with 500 "Database error querying schema":
--
--      Scan error on column index 3, name "confirmation_token":
--      converting NULL to string is unsupported
--
--    Row-level assertions cannot see this; only an actual token request can,
--    which is what supabase/tests/src/seed-demo.test.ts now does.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'demo@planpal.app', crypt('planpal-demo', gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}',
   '{"display_name":"Demo User","timezone_id":"America/New_York"}',
   '', '', '', '');

-- The on_auth_user_created trigger has now created the profile, notification
-- preferences and an initial friend code. Only the username needs a nicer value.
update public.users
  set username = 'demo', default_visibility = 'shared_all'
  where id = '33333333-3333-3333-3333-333333333333';

-- 2. A friend, so the sharing layer is visible rather than theoretical.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000',
   '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
   'demo-friend@planpal.app', crypt('planpal-demo', gen_salt('bf')), now(),
   now(), now(), '{"provider":"email","providers":["email"]}',
   '{"display_name":"Sam Rivera","timezone_id":"America/Los_Angeles"}',
   '', '', '', '')
on conflict (id) do nothing;

update public.users set username = 'sam'
  where id = '44444444-4444-4444-4444-444444444444';

insert into public.friend_connections
  (requester_id, addressee_id, status, accepted_at)
values
  ('33333333-3333-3333-3333-333333333333',
   '44444444-4444-4444-4444-444444444444', 'accepted', now())
on conflict do nothing;

-- 3. Standalone events across the current week.
insert into public.events
  (owner_id, title, description, local_start, local_end, timezone_id, visibility)
values
  ('33333333-3333-3333-3333-333333333333',
   'Coffee with Sam', 'Catch-up',
   (date_trunc('week', now())::date + 1 + interval '9 hours')::timestamp,
   (date_trunc('week', now())::date + 1 + interval '10 hours')::timestamp,
   'America/New_York', 'shared_all'),
  ('33333333-3333-3333-3333-333333333333',
   'Dentist', null,
   (date_trunc('week', now())::date + 3 + interval '14 hours 30 minutes')::timestamp,
   (date_trunc('week', now())::date + 3 + interval '15 hours 15 minutes')::timestamp,
   'America/New_York', 'private'),
  ('33333333-3333-3333-3333-333333333333',
   'Flight to SFO', 'Aisle seat',
   (date_trunc('week', now())::date + 5 + interval '6 hours 45 minutes')::timestamp,
   (date_trunc('week', now())::date + 5 + interval '10 hours 5 minutes')::timestamp,
   'America/New_York', 'shared_all');

-- 4. The recurrence showcase: a weekly master, one moved occurrence, one
--    cancelled. This is what demonstrates packages/recurrence, so it is not
--    optional decoration.
insert into public.events
  (id, owner_id, title, local_start, local_end, timezone_id, recurrence_rule, visibility)
values
  ('cccccccc-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333',
   'Standup',
   (date_trunc('week', now())::date + interval '9 hours 30 minutes')::timestamp,
   (date_trunc('week', now())::date + interval '9 hours 45 minutes')::timestamp,
   'America/New_York', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 'private');

-- Wednesday's occurrence moved half an hour later and renamed.
insert into public.events
  (owner_id, is_master, master_event_id, recurrence_exception_date,
   title, local_start, local_end, timezone_id)
values
  ('33333333-3333-3333-3333-333333333333', false,
   'cccccccc-0000-0000-0000-000000000001',
   (date_trunc('week', now())::date + 2),
   'Standup (moved)',
   (date_trunc('week', now())::date + 2 + interval '10 hours')::timestamp,
   (date_trunc('week', now())::date + 2 + interval '10 hours 15 minutes')::timestamp,
   'America/New_York');

-- Friday's occurrence cancelled (sparse exception row).
insert into public.events
  (owner_id, is_master, master_event_id, recurrence_exception_date, is_cancelled)
values
  ('33333333-3333-3333-3333-333333333333', false,
   'cccccccc-0000-0000-0000-000000000001',
   (date_trunc('week', now())::date + 4), true);

commit;
