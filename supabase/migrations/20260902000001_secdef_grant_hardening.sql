-- Migration: revoke PUBLIC execute on the remaining SECURITY DEFINER functions
-- ---------------------------------------------------------------------------
-- Problem
-- -------
-- Postgres grants EXECUTE to PUBLIC on every new function by default, and
-- PUBLIC includes Supabase's `anon` and `authenticated` roles. A SECURITY
-- DEFINER function runs as its owner and therefore bypasses RLS, so a default
-- grant on one hands every signed-in user an RLS-free entry point.
--
-- `20260901000002_notification_scheduler_hardening.sql` diagnosed exactly this
-- and fixed `prune_notification_sends(integer)` — but three functions were
-- left with the default grant:
--
--   public.sync_birthday_event(uuid)      =X/postgres  <-- PUBLIC
--   public.handle_new_user()              =X/postgres  <-- PUBLIC
--   public.on_user_birthday_change()      =X/postgres  <-- PUBLIC
--
-- `sync_birthday_event(p_user_id uuid)` is the exploitable one. It takes an
-- arbitrary user id with no `auth.uid()` check and, as SECURITY DEFINER,
-- ignores RLS. Verified against the local stack: as role `authenticated`,
-- user A could call it with user B's id and it succeeded. Its body runs
--
--   delete from public.events
--    where owner_id = p_user_id and color_label = '__birthday__'
--      and is_master = true;
--
-- then re-inserts the master from the victim's stored birthday. The master
-- comes back; the cascade-deleted occurrence exceptions do not. So any
-- authenticated user could destroy any other user's birthday overrides.
--
-- The two trigger functions are lower risk — Postgres refuses a direct call to
-- a `returns trigger` function — but they need no EXECUTE grant either, and
-- the standing rule admits no exceptions.
--
-- Fix
-- ---
-- Revoke from public/anon/authenticated. Nothing legitimate breaks:
--   * All three are reached only through triggers. A trigger executes as the
--     function owner, not the invoking role, so `postgres=X/postgres` is the
--     grant that matters and it is untouched.
--   * `sync_birthday_event` has exactly one caller, `on_user_birthday_change`
--     (20260614000001, line 80), which is itself SECURITY DEFINER and so calls
--     it with owner privileges.
--   * No Edge Function or client invokes any of them over PostgREST RPC.
--
-- Deliberately NOT adding an `auth.uid() = p_user_id` guard inside
-- `sync_birthday_event`: the trigger can legitimately fire from a context with
-- no JWT (a service-role or migration-time write to users.birthday), where
-- `auth.uid()` is null and the guard would reject a valid call. Removing the
-- grant closes the hole without that failure mode.
--
-- Rollback: `grant execute on function ... to public;` for each. Note that
-- doing so re-opens the cross-user write described above.
-- ---------------------------------------------------------------------------

revoke all on function public.sync_birthday_event(uuid) from public;
revoke all on function public.sync_birthday_event(uuid) from anon;
revoke all on function public.sync_birthday_event(uuid) from authenticated;

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

revoke all on function public.on_user_birthday_change() from public;
revoke all on function public.on_user_birthday_change() from anon;
revoke all on function public.on_user_birthday_change() from authenticated;

-- ---------------------------------------------------------------------------
-- Revoke execute on Supabase-provisioned SECURITY DEFINER functions that
-- would otherwise trip the §15 audit below.
--
-- rls_auto_enable() is created by the Supabase platform (owned by postgres)
-- in cloud projects but is absent from the local stack. It is invoked
-- exclusively from a DDL event trigger; PostgreSQL does not check EXECUTE
-- privilege for event trigger dispatch, so revoking from end-user roles is
-- safe and has no effect on trigger firing. The conditional block prevents
-- a "function does not exist" error during local pnpm db:reset.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public;
    revoke all on function public.rls_auto_enable() from anon;
    revoke all on function public.rls_auto_enable() from authenticated;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enforce the rule mechanically, not by convention.
--
-- §15 of IMPLEMENTATION_PLAN.md: "Every SECURITY DEFINER function ships with
-- `revoke execute from public, anon, authenticated` in the same migration."
-- M2 wrote that rule down and then missed three functions anyway, so assert it
-- here: `pnpm db:reset` now fails if any SECURITY DEFINER function in `public`
-- is executable by an end-user role. T22 turns this into a CI test; until then
-- the migration chain itself is the gate.
-- ---------------------------------------------------------------------------
do $$
declare
  v_leaks text;
begin
  select string_agg(
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)),
           ', ' order by p.proname)
    into v_leaks
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname = 'public'
     and (
       has_function_privilege('public',        p.oid, 'EXECUTE') or
       has_function_privilege('anon',          p.oid, 'EXECUTE') or
       has_function_privilege('authenticated', p.oid, 'EXECUTE')
     );

  if v_leaks is not null then
    raise exception
      'SECURITY DEFINER function(s) executable by public/anon/authenticated: %',
      v_leaks
      using hint = 'Add "revoke all on function <fn> from public, anon, '
                   'authenticated;" to the migration that creates it (see §15).';
  end if;
end;
$$;
