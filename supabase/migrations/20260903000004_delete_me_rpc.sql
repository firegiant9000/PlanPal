-- Migration: account deletion RPC for DELETE /me (T14)
-- ---------------------------------------------------------------------------
-- Why an RPC at all
-- -----------------
-- The Edge Function holds a user-scoped client. It can delete `public.users`,
-- but the row that matters is `auth.users` — everything else cascades from it,
-- and deleting only the public row would leave a login that works and a profile
-- that no longer exists. A user-scoped client has no rights in the `auth`
-- schema, so the deletion has to happen inside a function that does.
--
-- The alternative was a service-role admin call from the function. Rejected:
-- §3 scopes that key to `notify-scheduler` alone, and a full-privilege key
-- inside a user-facing endpoint is a much larger blast radius than one function
-- that can only ever delete its own caller.
--
-- Why it takes no arguments
-- -------------------------
-- §6 sketches `delete_me(p_user_id)` with an `auth.uid() = p_user_id` guard.
-- Taking no parameter is strictly safer: a guard can be dropped in a later edit
-- and the function silently becomes an any-account deleter, whereas a function
-- with nothing to point at cannot be aimed at all. auth.uid() is read once,
-- internally, and is the only account this can touch.
--
-- Why `authenticated` KEEPS execute, unlike every other SECURITY DEFINER
-- ---------------------------------------------------------------------
-- §15 says revoke from public, anon and authenticated. Applied literally here
-- it would break the feature: the caller IS an authenticated user deleting
-- their own account, so revoking from `authenticated` means nobody can ever
-- invoke it and the GDPR path is dead on arrival.
--
-- The rule exists to stop a SECURITY DEFINER function being reachable by
-- someone it was not written for — which is exactly the hole M2 shipped. That
-- risk is absent here because the function has no target parameter: every
-- caller, authorised or not, can only delete themselves. So `public` and `anon`
-- are revoked and `authenticated` is granted explicitly, which is a deliberate,
-- reviewable decision rather than the default PUBLIC grant.
--
-- The grant audit in supabase/tests/src/grants.test.ts carries a matching
-- allowlist entry. Adding to that list is a visible act in review; forgetting a
-- revoke is not, which is the asymmetry that matters.
--
-- Rollback: drop the function. DELETE /me then 405s, which is the honest state
-- for an endpoint that cannot do its job.
-- ---------------------------------------------------------------------------

create or replace function public.delete_me()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- No JWT, no deletion. Belt and braces: `authenticated` is the only role
  -- granted execute, so this should be unreachable without a claim.
  if v_user_id is null then
    raise exception 'delete_me requires an authenticated caller'
      using errcode = '28000';
  end if;

  -- Everything hangs off auth.users by ON DELETE CASCADE:
  --   auth.users -> public.users -> events, devices, friend_codes,
  --                 friend_connections (both sides), notification_preferences
  --   devices    -> notification_sends
  -- so this single delete removes the account and all of its data. Deleting
  -- public.users instead would leave a working login with no profile.
  delete from auth.users where id = v_user_id;
end;
$$;

comment on function public.delete_me() is
  'Deletes the calling user''s account and everything cascading from it (GDPR '
  'erasure, DELETE /me). Takes no arguments and reads auth.uid() internally, so '
  'it can only ever delete its own caller — that is why `authenticated` keeps '
  'execute here while every other SECURITY DEFINER function has it revoked. See '
  'the allowlist in supabase/tests/src/grants.test.ts.';

revoke all on function public.delete_me() from public;
revoke all on function public.delete_me() from anon;
grant execute on function public.delete_me() to authenticated;
