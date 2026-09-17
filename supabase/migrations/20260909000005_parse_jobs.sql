-- parse_jobs: screenshot-to-schedule pipeline job records (M5, Step 1).
-- One row per upload attempt. The parse worker updates status as it progresses
-- through the OCR → LLM extraction → normalisation → conflict-detection stages.
--
-- Rate-limit window: at most 15 queued/processing/done jobs per user per 24 h
-- (enforced in the Edge Function, not here — the table is the ledger).
--
-- Rollback (forward-only project): drop table public.parse_jobs cascade;

create table public.parse_jobs (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.users(id) on delete cascade,
  storage_path text        not null,
  status       text        not null default 'queued'
                           check (status in ('queued', 'processing', 'done', 'failed')),
  event_count  integer,
  error_code   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger parse_jobs_set_updated_at
  before update on public.parse_jobs
  for each row execute function public.set_updated_at();

-- Covering index for the 24-hour rate-limit count and status-poll queries.
create index parse_jobs_user_created_idx on public.parse_jobs (user_id, created_at desc);

-- Owner-only: users may only read and manage their own jobs.
alter table public.parse_jobs enable row level security;

grant select, insert, update on public.parse_jobs to authenticated;

create policy parse_jobs_owner_all on public.parse_jobs
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
