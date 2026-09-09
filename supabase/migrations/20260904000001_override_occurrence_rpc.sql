-- Migration: atomic occurrence override for PATCH /events/{id}/occurrences/{date}
-- ---------------------------------------------------------------------------
-- The bug
-- -------
-- PATCH on an occurrence has merge semantics: fields the request does not name
-- keep whatever the existing exception row holds. The Edge Function implemented
-- that as read-existing / merge-in-JS / upsert, which is a lost update between
-- the read and the write.
--
-- Measured, not theorised: two concurrent PATCHes to the same occurrence, one
-- setting `title` and one setting the times, lost the title in 5 of 12 rounds
-- (~42%) against the local stack. Both requests read the same prior row, each
-- built a full row from it, and the second upsert overwrote the first's field
-- with the pre-read value.
--
-- This is the same failure §6 already calls out for friend-code rotation —
-- "Do it in one RPC — two statements race" — and the same class as the
-- rotation race fixed in 20260903000005. It is not exotic: an offline queue
-- flushing two edits (T29) or a double-tap produces it.
--
-- The fix
-- -------
-- One INSERT ... ON CONFLICT DO UPDATE, so the merge happens inside the
-- statement against the live row rather than against a value read earlier.
--
-- The patch arrives as jsonb because the merge needs THREE states per field,
-- which a nullable argument cannot express: absent (keep the current value),
-- null (explicitly clear it — the contract allows null for description,
-- location and colorLabel), or a value. `p_patch ? 'key'` distinguishes absent
-- from present-and-null; a plain `coalesce(p_arg, e.col)` cannot, and would
-- silently turn "clear this field" into "leave it alone".
--
-- SECURITY INVOKER deliberately: the insert reads owner_id from the master row
-- via a subselect, so it only ever writes for a master the caller can actually
-- see under RLS, and the exception row it writes is subject to the caller's own
-- insert/update policies. There is no privilege to escalate, so the §15
-- revoke-from-public rule for SECURITY DEFINER functions does not apply. The
-- grants below are still explicit rather than inherited from PUBLIC.
--
-- Validation stays in the Edge Function. This function is the atomic write, not
-- the contract gate: the handler still rejects undeclared fields, malformed
-- values, dates the series never generates, and merged windows that would end
-- before they start.
--
-- Rollback: drop the function and restore the read-merge-upsert in
-- events/index.ts. That reintroduces the lost update.
-- ---------------------------------------------------------------------------

create or replace function public.override_occurrence(
  p_master_id uuid,
  p_date date,
  p_patch jsonb
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.events;
begin
  insert into public.events as e (
    owner_id,
    master_event_id,
    recurrence_exception_date,
    is_master,
    is_cancelled,
    title,
    description,
    location,
    local_start,
    local_end,
    visibility,
    color_label
  )
  select
    m.owner_id,
    m.id,
    p_date,
    false,
    -- Overriding a previously-cancelled occurrence reinstates it.
    false,
    case when p_patch ? 'title'       then p_patch ->> 'title'       else null end,
    case when p_patch ? 'description' then p_patch ->> 'description' else null end,
    case when p_patch ? 'location'    then p_patch ->> 'location'    else null end,
    case when p_patch ? 'localStart'  then (p_patch ->> 'localStart')::timestamp else null end,
    case when p_patch ? 'localEnd'    then (p_patch ->> 'localEnd')::timestamp   else null end,
    case when p_patch ? 'visibility'  then (p_patch ->> 'visibility')::public.visibility else null end,
    case when p_patch ? 'colorLabel'  then p_patch ->> 'colorLabel'  else null end
  from public.events m
  where m.id = p_master_id
    and m.is_master
  on conflict (master_event_id, recurrence_exception_date) do update
  set
    is_cancelled = false,
    title       = case when p_patch ? 'title'       then p_patch ->> 'title'       else e.title end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else e.description end,
    location    = case when p_patch ? 'location'    then p_patch ->> 'location'    else e.location end,
    local_start = case when p_patch ? 'localStart'  then (p_patch ->> 'localStart')::timestamp else e.local_start end,
    local_end   = case when p_patch ? 'localEnd'    then (p_patch ->> 'localEnd')::timestamp   else e.local_end end,
    visibility  = case when p_patch ? 'visibility'  then (p_patch ->> 'visibility')::public.visibility else e.visibility end,
    color_label = case when p_patch ? 'colorLabel'  then p_patch ->> 'colorLabel'  else e.color_label end
  returning * into v_row;

  -- No row means the master does not exist or RLS hid it. The caller maps this
  -- to 404; raising here instead would surface as an opaque 500.
  return v_row;
end;
$$;

comment on function public.override_occurrence(uuid, date, jsonb) is
  'Atomically upserts the exception row for one occurrence, merging only the '
  'keys present in p_patch. Replaces a read-merge-upsert in events/index.ts '
  'that lost concurrent edits ~42% of the time. jsonb rather than typed '
  'arguments because the merge needs absent/null/value as three distinct '
  'states. SECURITY INVOKER: owner_id comes from the master row via subselect, '
  'so it is bounded by the caller''s own RLS policies.';

revoke all on function public.override_occurrence(uuid, date, jsonb) from public;
grant execute on function public.override_occurrence(uuid, date, jsonb) to authenticated;
grant execute on function public.override_occurrence(uuid, date, jsonb) to service_role;
