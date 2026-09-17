-- parse_spend_ledger: per-call cost record for the screenshot-parse pipeline's
-- external API usage (M5 cross-cutting — cost monitoring & budget alerts).
-- One row per priced external call (currently: each Claude OCR/extraction
-- call). `parse/index.ts` sums this over a trailing 24h window to decide
-- whether to trip the spend kill-switch (503 SERVICE_UNAVAILABLE on new jobs).
--
-- Internal/ops data only — no end-user access. Unlike parse_jobs (owner-only
-- RLS), this table grants nothing to `authenticated`/`anon`; only the service
-- role (which bypasses RLS) reads or writes it, from parse-worker and parse.
--
-- Rollback (forward-only project): drop table public.parse_spend_ledger cascade;

create table public.parse_spend_ledger (
  id         uuid        primary key default gen_random_uuid(),
  job_id     uuid        not null references public.parse_jobs(id) on delete cascade,
  provider   text        not null check (provider in ('claude')),
  stage      text        not null check (stage in ('ocr', 'extraction')),
  cost_usd   numeric(10, 6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

-- Covering index for the "sum cost in the trailing 24h" kill-switch query.
create index parse_spend_ledger_created_idx on public.parse_spend_ledger (created_at);

alter table public.parse_spend_ledger enable row level security;
-- No grants, no policies: service-role only (RLS does not apply to it).
