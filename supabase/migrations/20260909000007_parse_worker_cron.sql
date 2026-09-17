-- Schedule parse-worker to fire every minute (same pattern as notify-scheduler).
-- ---------------------------------------------------------------------------
-- REUSES the existing vault entries:
--   cron_secret   — the shared X-Cron-Secret the handler checks
--   anon_key      — the project's anon key (sent as apikey + Authorization)
--
-- REQUIRES one new vault entry per environment, created once by an operator:
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1/parse-worker',
--     'parse_worker_function_url'
--   );
--
-- The same CRON_SECRET function secret (used by notify-scheduler) must also be
-- set on parse-worker — it is already deployed as a project secret so no
-- additional `supabase secrets set` call is needed.
--
-- Until parse_worker_function_url exists, each tick fails with:
--   cron.job_run_details.status = 'failed'
--   'null value in column "url"...'
-- Nothing reaches net._http_response — diagnose at both layers (see SECRETS.md).
--
-- ROLLBACK: select cron.unschedule('parse-worker');
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;

-- cron.schedule upserts by name, so db:reset replaces rather than duplicates.
select cron.schedule('parse-worker', '* * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'parse_worker_function_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb)
$$);
