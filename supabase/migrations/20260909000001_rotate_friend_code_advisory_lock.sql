-- Migration: rotate_friend_code takes its own lock instead of borrowing one
-- ---------------------------------------------------------------------------
-- 20260903000005 fixed a real race by serialising rotations on the caller's
-- `public.users` row:
--
--   perform 1 from public.users where id = v_user_id for update;
--
-- It works, and the 8-caller concurrency test in friend-code.test.ts is clean
-- against it. This migration is not a bug fix — it removes a coupling.
--
-- WHY, given it works
-- -------------------
-- 1. The lock only exists if that `perform` matches a row **under RLS**. It is
--    the only FOR UPDATE in the repo, and it depends on `users_update_self`
--    (or whatever policy governs SELECT on users) continuing to return the
--    caller's own row. Narrow that policy — a column-restricted one for T19's
--    settings screen, say — and the perform matches zero rows, no lock is
--    taken, and the 1-in-3 race silently returns. Nothing would fail at the
--    time of the change; the concurrency test would just start flaking later.
--
--    This is the same class of latent failure as the bug it replaced: a lock
--    that quietly is not taken, rather than an error.
--
-- 2. It makes "the users row is a mutex" an undeclared convention. M6's
--    friend-by-code redemption is the natural first feature to lock a
--    `friend_codes` row and then touch `users` — the opposite order — which is
--    the classic deadlock pair.
--
-- A transaction-scoped advisory lock has neither property: it is not a row, so
-- no policy can hide it, and its key space is ours to name.
--
-- The key is prefixed with the function name so a future second advisory lock
-- cannot land in the same space by accident. `hashtext` can collide across
-- different key strings in principle; with one key string that is irrelevant,
-- and the prefix is what keeps it irrelevant as more are added.
--
-- Everything else is byte-identical to 20260903000005. Note that this is the
-- THIRD migration to define this function (20260903000003, ...005, this one)
-- and they were deliberately not consolidated: ...005's message is the only
-- record of why the obvious FOR UPDATE target was wrong. Keep it that way.
--
-- Rollback: forward-only. The forward "down" is another
-- `create or replace function public.rotate_friend_code()` restoring
-- 20260903000005's body verbatim, which reinstates the users-row lock (and
-- with it the coupling described above, not the original race).
-- ---------------------------------------------------------------------------

create or replace function public.rotate_friend_code()
returns public.friend_codes
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_new public.friend_codes;
begin
  if v_user_id is null then
    raise exception 'rotate_friend_code requires an authenticated caller'
      using errcode = '28000';
  end if;

  -- Serialise rotations for this user on a lock of our own. Transaction-scoped,
  -- so it is released on commit or rollback with nothing to unlock by hand.
  -- Unlike a row lock it does not depend on any row being visible under RLS.
  perform pg_advisory_xact_lock(hashtext('rotate_friend_code:' || v_user_id::text));

  update public.friend_codes
     set expires_at = now() + interval '30 days'
   where user_id = v_user_id and expires_at is null;

  insert into public.friend_codes (user_id, code)
  values (v_user_id, public.generate_friend_code())
  returning * into v_new;

  return v_new;
end;
$$;

-- Restated, not assumed: `create or replace function` leaves grants untouched,
-- so these are already in force from the earlier migrations. §15 wants the
-- migration to be self-describing about who may execute what.
revoke all on function public.rotate_friend_code() from public;
revoke all on function public.rotate_friend_code() from anon;
grant execute on function public.rotate_friend_code() to authenticated;
grant execute on function public.rotate_friend_code() to service_role;

comment on function public.rotate_friend_code() is
  'Expires the caller''s active friend code (30-day grace) and issues a new one, '
  'atomically. Serialises concurrent rotations for one user on a transaction '
  'advisory lock keyed ''rotate_friend_code:<uuid>''. It previously locked the '
  'public.users row (20260903000005); that worked but only while RLS kept that '
  'row visible to the caller, and it made the users row an undeclared mutex '
  'that M6''s friend-by-code redemption would have had to lock in the opposite '
  'order. SECURITY INVOKER: it reads auth.uid() itself and is bounded by the '
  'caller''s RLS policy, so it cannot be aimed at another account.';
