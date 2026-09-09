-- Migration: fix the rotation race that 20260903000003 did not actually close
-- ---------------------------------------------------------------------------
-- The bug
-- -------
-- `rotate_friend_code()` serialised concurrent callers with
--
--   perform 1 from public.friend_codes
--    where user_id = v_user_id and expires_at is null
--      for update;
--
-- which looks right and is not. It locks the row that is about to stop
-- qualifying. Under READ COMMITTED, a blocked SELECT ... FOR UPDATE re-checks
-- the updated row version against its WHERE clause once the lock is released —
-- and by then `expires_at` is set, so the row no longer matches. The waiter
-- therefore acquires NO lock and falls straight through. Postgres has no gap
-- lock to catch the empty case.
--
-- With five concurrent rotations the sequence is:
--
--   1. all five block on the one active row
--   2. the winner expires it, inserts a replacement, commits
--   3. the other four re-evaluate, match nothing, and proceed unserialised
--   4. they all expire the new row and all insert
--   5. the second and later inserts violate
--      friend_codes_one_active_per_user
--
-- Observed as a 409 "That record already exists" on roughly one full-suite run
-- in three — precisely the failure the RPC was introduced to prevent, and
-- exactly the kind that a single manual test would never surface. The
-- concurrency test in supabase/tests/src/friend-code.test.ts found it.
--
-- The fix
-- -------
-- Lock a row that always exists and never stops qualifying: the user. The FK
-- from friend_codes.user_id guarantees `public.users` has the row, so the lock
-- is always taken and every rotation for that user serialises regardless of
-- what happens to the code rows.
--
-- The cost is that a rotation briefly blocks a concurrent profile update for
-- the same user. That is one person's own two requests racing each other, it
-- resolves in milliseconds, and it is a great deal cheaper than a rotation
-- that intermittently 409s.
--
-- Rollback: restore the previous body from 20260903000003, which reintroduces
-- the race.
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

  -- Serialise on the user, not on the code row. The code row stops matching
  -- the moment it is expired, which releases waiters without a lock; the user
  -- row always exists and always qualifies.
  perform 1 from public.users where id = v_user_id for update;

  update public.friend_codes
     set expires_at = now() + interval '30 days'
   where user_id = v_user_id and expires_at is null;

  insert into public.friend_codes (user_id, code)
  values (v_user_id, public.generate_friend_code())
  returning * into v_new;

  return v_new;
end;
$$;

comment on function public.rotate_friend_code() is
  'Expires the caller''s active friend code (30-day grace) and issues a new one, '
  'atomically. Serialises on the public.users row rather than the active code '
  'row: the code row stops matching once expired, which releases blocked '
  'waiters without a lock and lets them race the insert (see '
  '20260903000005). SECURITY INVOKER: it reads auth.uid() itself and is bounded '
  'by the caller''s RLS policy, so it cannot be aimed at another account.';
