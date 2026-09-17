-- feedback: in-app user feedback / bug reports (M5 cross-cutting — user
-- support & feedback loop). One row per submission via POST /feedback.
--
-- Owner-scoped SELECT + INSERT only — no UPDATE, no DELETE for end users.
-- Triage (reading across all users, changing `status`) happens from the
-- Supabase dashboard or a future admin surface using the service role, which
-- bypasses RLS entirely; nothing in this policy set grants that to a caller.
-- SELECT is granted (not just INSERT) so a submission's own row can be
-- returned via PostgREST's insert-with-select, and so the Edge Function can
-- rate-limit a user against their own row count the same way `parse_jobs`
-- does for parse jobs.
--
-- Rollback (forward-only project): drop table public.feedback cascade;

create table public.feedback (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  message    text        not null check (char_length(message) between 1 and 2000),
  context    jsonb,
  status     text        not null default 'new' check (status in ('new', 'triaged', 'closed')),
  created_at timestamptz not null default now()
);

-- Covering index for the per-user rate-limit count query.
create index feedback_user_created_idx on public.feedback (user_id, created_at desc);

alter table public.feedback enable row level security;

grant select, insert on public.feedback to authenticated;

create policy feedback_owner_select on public.feedback
  for select to authenticated
  using (user_id = auth.uid());

create policy feedback_owner_insert on public.feedback
  for insert to authenticated
  with check (user_id = auth.uid());
