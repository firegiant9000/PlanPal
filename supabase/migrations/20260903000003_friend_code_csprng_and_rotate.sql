-- Migration: CSPRNG friend codes + an atomic rotation RPC
-- ---------------------------------------------------------------------------
-- 1. PREDICTABLE CODES
--
-- `generate_friend_code()` built its 8 characters from `random()`, which is a
-- deterministic PRNG seeded per session. It is not a security primitive, and a
-- friend code is the token that gates access to somebody's calendar. Someone
-- who can observe a few codes issued by the same backend session can narrow the
-- sequence; even without that, `random()` offers no guarantee of unpredictability.
--
-- `gen_random_bytes()` (pgcrypto) is a CSPRNG. Same alphabet, same length, same
-- collision retry loop — only the source of randomness changes.
--
-- Modulo bias: 256 is not a multiple of 36, so `byte % 36` would favour the
-- first four letters of the alphabet slightly. Bytes >= 252 are rejected and
-- redrawn instead (252 = 36 * 7), which keeps the distribution uniform.
--
-- 2. RACING ROTATION
--
-- `friend_codes_one_active_per_user` is a PARTIAL unique index over user_id
-- WHERE expires_at IS NULL — one active code per user. Rotating means expiring
-- the current code and inserting a new one. As two statements from the Edge
-- Function that is a race: two concurrent rotations both read one active row,
-- both expire it, and both insert — the second insert violates the index and
-- the caller sees a 409 for an operation that should always succeed. Worse, an
-- interruption between the two statements leaves the user with NO active code
-- and no way to get one, since the endpoint would then be inserting alongside
-- nothing to expire.
--
-- Doing it in one function makes the pair atomic, and `for update` on the
-- existing row serialises concurrent rotations rather than letting them collide.
--
-- SECURITY INVOKER deliberately: rotation must be constrained by the caller's
-- own RLS policy (`user_id = auth.uid()`), so there is nothing to escalate and
-- the §15 revoke rule for SECURITY DEFINER functions does not apply. The
-- function takes no user id at all — it reads auth.uid() itself, so it cannot
-- be pointed at someone else's account.
--
-- Rollback: restore the previous generate_friend_code() body and drop
-- rotate_friend_code(). Note the old body reintroduces random().
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

create or replace function public.generate_friend_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  -- 36 * 7 = 252. Bytes at or above this are discarded to avoid modulo bias.
  max_unbiased constant int := 252;
  result text;
  b int;
begin
  loop
    result := '';
    while length(result) < 8 loop
      b := get_byte(extensions.gen_random_bytes(1), 0);
      if b < max_unbiased then
        result := result || substr(alphabet, 1 + (b % 36), 1);
      end if;
    end loop;
    exit when not exists (select 1 from public.friend_codes where code = result);
  end loop;
  return result;
end;
$$;

comment on function public.generate_friend_code() is
  'Generates an unused 8-character friend code using gen_random_bytes (CSPRNG). '
  'Bytes >= 252 are discarded so the modulo into a 36-character alphabet stays '
  'uniform. A friend code gates calendar access, so random() is the wrong '
  'primitive here.';

-- ---------------------------------------------------------------------------
-- Atomic rotation.
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

  -- Lock the current active row first. Two concurrent rotations then queue
  -- rather than both expiring it and both inserting.
  perform 1
     from public.friend_codes
    where user_id = v_user_id and expires_at is null
      for update;

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
  'atomically. Split across two statements this races '
  'friend_codes_one_active_per_user, and an interruption between them can leave '
  'a user with no active code at all. SECURITY INVOKER: it reads auth.uid() '
  'itself and is bounded by the caller''s RLS policy, so it cannot be aimed at '
  'another account.';

revoke all on function public.rotate_friend_code() from public;
grant execute on function public.rotate_friend_code() to authenticated;
grant execute on function public.rotate_friend_code() to service_role;
