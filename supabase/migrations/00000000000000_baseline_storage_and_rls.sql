-- Migration: baseline storage buckets + RLS posture (Phase 0)
-- ---------------------------------------------------------------------------
-- Scope: ONLY storage buckets and their access policies, plus a project-wide
-- "deny by default" RLS posture. The core domain schema (events,
-- notification_preferences, users, friend_connections, friend_codes) is
-- intentionally NOT here — it is owned by Phase 2 and ships in later migrations
-- once the data model is reviewed and frozen.
--
-- Rollback: see the paired down migration / runbook in docs/BOOTSTRAP.md.
--   - delete from storage.buckets where id in ('avatars','screenshots');
--   - drop the policies created below.
-- ---------------------------------------------------------------------------

-- 1. Storage buckets ---------------------------------------------------------
-- avatars: profile images. Publicly readable (shown on friends' calendars),
--          owner-writable.
-- screenshots: schedule images uploaded for AI parsing. PRIVATE — these can
--          contain sensitive personal schedule data and are sent to a
--          third-party model; only the owner may ever read them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('screenshots', 'screenshots', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- 2. Storage RLS policies ----------------------------------------------------
-- Convention: an object is "owned" by the user whose UID is the first path
-- segment, e.g. avatars/<user_id>/avatar.png. Clients must upload under their
-- own UID prefix.

-- avatars: anyone may read; only the owner may write/update/delete their own.
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars_owner_write"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "avatars_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- screenshots: fully private to the owner for every operation.
create policy "screenshots_owner_read"
  on storage.objects for select
  using (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "screenshots_owner_write"
  on storage.objects for insert
  with check (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "screenshots_owner_update"
  on storage.objects for update
  using (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "screenshots_owner_delete"
  on storage.objects for delete
  using (
    bucket_id = 'screenshots'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- 3. Default RLS posture for the public schema -------------------------------
-- Privacy is a zero-tolerance requirement (see DEVELOPMENT_PLAN risks). Make
-- "no access" the default: revoke blanket grants so that any future table is
-- unreachable until an explicit policy is written for it. Phase 2 tables must
-- each `enable row level security` and define policies before exposure.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;

alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on routines from anon, authenticated;
