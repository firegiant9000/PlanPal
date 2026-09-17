alter table public.parse_jobs
  add column retry_count integer not null default 0;
