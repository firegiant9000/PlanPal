-- Migration: stop granting PUBLIC execute on our own helper functions
-- ---------------------------------------------------------------------------
-- Found by auditing the freshly-provisioned planpal-dev project rather than
-- the local stack: `supabase db dump` showed a `REVOKE ALL ... FROM PUBLIC`
-- line for eight of our functions and none for `generate_friend_code`.
-- Confirmed with has_function_privilege('public', oid, 'EXECUTE'), which is
-- true for three functions we own:
--
--   public.generate_friend_code()   returns text
--   public.events_derive_utc()      returns trigger
--   public.set_updated_at()         returns trigger
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default, so this
-- is what "forgot the revoke" looks like — the omission is invisible unless
-- something goes looking, which is the same asymmetry §15 exists to correct.
--
-- Is it exploitable today? No, and that is not the reason to fix it.
--
--   - All three are SECURITY INVOKER, so they run with the caller's rights.
--   - The two trigger functions raise if called outside a trigger context.
--   - generate_friend_code() only reads friend_codes (RLS-filtered) and
--     returns a random string; it writes nothing.
--
-- The reason to fix it is what happens next. The PR that found this recommends
-- making generate_friend_code() SECURITY DEFINER, because its collision-retry
-- loop is RLS-filtered on the rotate path and cannot see other users' codes.
-- Adding `security definer` to a function that PUBLIC can already execute
-- creates precisely the hole Month 2 shipped, in one word, with no revoke to
-- forget — and grants.test.ts audits SECURITY DEFINER functions only, so it
-- would have reported the breach after the fact rather than preventing it.
-- Revoking now means that future change cannot go wrong quietly.
--
-- WHO STILL NEEDS EXECUTE
--   generate_friend_code  `authenticated`, because rotate_friend_code() is
--                         SECURITY INVOKER and calls it as the end user.
--                         handle_new_user() is SECURITY DEFINER and runs as the
--                         function owner, so the signup path is unaffected.
--   trigger functions     nobody. Firing a trigger does not check EXECUTE on
--                         its function; only CREATE TRIGGER does. Verified by
--                         on_user_birthday_change, which has been revoked from
--                         PUBLIC since 20260902000001 while its triggers keep
--                         working (the birthday tests prove it). service_role
--                         is granted anyway, matching the convention the other
--                         trigger functions already follow.
--
-- Rollback: `grant execute on function <fn> to public` restores the default for
-- each. Note that doing so re-opens the trap described above.
-- ---------------------------------------------------------------------------

revoke all on function public.generate_friend_code() from public;
grant execute on function public.generate_friend_code() to authenticated;
grant execute on function public.generate_friend_code() to service_role;

revoke all on function public.events_derive_utc() from public;
grant execute on function public.events_derive_utc() to service_role;

revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to service_role;

comment on function public.generate_friend_code() is
  'Generates an unused 8-character friend code using gen_random_bytes (CSPRNG). '
  'Bytes >= 252 are discarded so the modulo into a 36-character alphabet stays '
  'uniform. A friend code gates calendar access, so random() is the wrong '
  'primitive here. EXECUTE is revoked from PUBLIC and granted to '
  '`authenticated` only because rotate_friend_code() is SECURITY INVOKER and '
  'calls this as the end user — see 20260908000001 for why PUBLIC must not '
  'keep it.';
