-- Migration: actually schedule notify-scheduler (T27)
-- ---------------------------------------------------------------------------
-- The schedule has never fired anywhere. `cron.job` is empty on every
-- environment, so the reminder pipeline — the feature the app exists for — has
-- been dead code since M2. Push on real devices is MVP gate #3, and without a
-- tick there is nothing to deliver.
--
-- WHY NOT THE SNIPPET IN 20260614000002
-- -------------------------------------
-- That migration carries a commented-out `cron.schedule` block (lines 142-149)
-- which is wrong in two ways, and both would fail at runtime rather than at
-- apply time:
--
--   1. It reads its secrets with `current_setting('app.notify_url')` and
--      friends. Those are GUCs — session settings — not the vault. Nothing
--      sets them, so every tick would raise `unrecognized configuration
--      parameter`.
--   2. It sends the SERVICE ROLE key as the bearer token. §3 confines that key
--      to Edge Function secrets; putting it in a database row readable by the
--      job's owner widens its blast radius for no benefit. The anon key is
--      enough to cross Kong, and the `X-Cron-Secret` header is what actually
--      authorises the call.
--
-- That snippet is superseded by this file. It is left in place because
-- migrations are forward-only and it has already been applied.
--
-- WHAT AUTHORISES THE CALL
-- ------------------------
-- Verified locally: a `net.http_post` carrying only `Content-Type` and
-- `X-Cron-Secret` is rejected by the gateway with
-- `401 UNAUTHORIZED_NO_AUTH_HEADER` — it never reaches the function. Adding
-- `apikey: <anon>` alone is enough to get through Kong. The handler then
-- checks `X-Cron-Secret` itself, which is the real gate: Supabase's own JWT
-- check proves only that the caller holds the public anon key.
--
-- SECRETS ARE READ AT EACH TICK, not at apply time. That is deliberate: this
-- migration can land before an operator has created the vault entries, and
-- until they exist each tick fails visibly rather than silently doing nothing.
--
-- WHERE that failure shows depends on which stage fails, and the difference
-- matters when diagnosing at 3am — verified locally by deleting each secret in
-- turn:
--
--   secret MISSING   -> `cron.job_run_details.status = 'failed'`, message
--                       `null value in column "url" of relation
--                        "http_request_queue" violates not-null constraint`.
--                       Nothing reaches `net._http_response` at all, because
--                       the request is never queued.
--   secret WRONG     -> `cron.job_run_details.status = 'succeeded'` (the job
--                       did its job: it made the call) and
--                       `net._http_response.status_code = 403`.
--
-- So a green `cron.job_run_details` is NOT evidence the tick worked. Check
-- both layers. See docs/SECRETS.md for the three `vault.create_secret` calls
-- and their owners.
--
-- ROLLBACK (forward-only)
--   select cron.unschedule('notify-scheduler');
-- and leave `pg_net` installed — dropping an extension other things may come
-- to use is a bigger change than the schedule it was added for. On a cloud
-- environment, `cron.unschedule` plus deleting the three vault secrets stops it
-- completely. `cron.unschedule` is also the emergency stop if the scheduler
-- misbehaves in production: it needs no deploy.
-- ---------------------------------------------------------------------------

create extension if not exists pg_net;

-- `cron.schedule` upserts by name, so re-running this (as `pnpm db:reset`
-- does) replaces the job rather than accumulating duplicates.
select cron.schedule('notify-scheduler', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_function_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',       (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'X-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
