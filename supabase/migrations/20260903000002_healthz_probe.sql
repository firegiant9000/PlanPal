-- Migration: a probe function for /healthz
-- ---------------------------------------------------------------------------
-- Why this exists
-- ---------------
-- /healthz is unauthenticated by contract (`security: []`) and must perform a
-- real round-trip to Postgres — a probe that answers "ok" while its database is
-- unreachable turns an outage into a silent one.
--
-- It cannot do that by reading a table. `anon` holds NO grants at all on any
-- table in `public` (verified: information_schema.role_table_grants returns
-- zero rows for that role), so every table read fails with 42501 before RLS is
-- even consulted. That is a deliberate and good posture; the probe should not
-- weaken it by granting anon access to real data just to prove liveness.
--
-- So: a function that takes no arguments, touches no table, and returns a
-- constant. Executing it still crosses Kong -> PostgREST -> Postgres and runs
-- inside the database, which is exactly the signal wanted, while exposing
-- nothing whatsoever if it is called by anyone.
--
-- SECURITY INVOKER (the default, stated explicitly here because it matters):
-- there is no privilege to escalate, so the §15 revoke-from-public rule that
-- governs SECURITY DEFINER functions does not apply. The grants below are
-- still explicit rather than relying on the default grant to PUBLIC, so the
-- set of callers is written down rather than inherited.
--
-- Rollback: drop the function; /healthz then reports unhealthy, which is
-- correct — it would no longer be able to prove the database is reachable.
-- ---------------------------------------------------------------------------

create or replace function public.healthz()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select true $$;

comment on function public.healthz() is
  'Liveness probe for GET /healthz. Touches no table and returns a constant, so '
  'it proves Kong -> PostgREST -> Postgres is answering without granting anon '
  'access to any data. SECURITY INVOKER: nothing to escalate.';

revoke all on function public.healthz() from public;
grant execute on function public.healthz() to anon;
grant execute on function public.healthz() to authenticated;
grant execute on function public.healthz() to service_role;
