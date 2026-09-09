-- Migration: give the notify-scheduler cron job an Authorization header
-- ---------------------------------------------------------------------------
-- 20260909000003 sends `apikey` alone, on the evidence that the LOCAL gateway
-- accepts it. The CLOUD gateway does not, and the difference is invisible until
-- the job runs against a real project.
--
-- THE RED RUN, on planpal-dev (dhsfivkumctnstziokmu), 2026-09-08. Three
-- consecutive scheduled ticks with all three vault secrets present:
--
--   net._http_response.status_code = 401
--   {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
--
-- Isolated by direct request against the deployed function, one header changed
-- at a time:
--
--   apikey + X-Cron-Secret, no Authorization        -> 401 UNAUTHORIZED_NO_AUTH_HEADER
--   apikey + Authorization: Bearer <anon> + secret  -> 200 {"dispatched":0,"candidates":0}
--   ...the same, but a wrong X-Cron-Secret          -> 403 {"error":"Forbidden."}
--
-- So `Authorization` is what the gateway requires, and `X-Cron-Secret` is still
-- the check that actually authorises the work. The 403 also proves the function
-- secret is set and compared, which a 200 alone would not.
--
-- WHY NOT `verify_jwt = false`
-- ----------------------------
-- The M3/M4 plan's written fallback for this 401 was to disable JWT
-- verification for this one function and let X-Cron-Secret be the only gate.
-- That was chosen believing no other option existed. It is strictly weaker: it
-- exposes the handler to the internet up to the secret comparison. Sending the
-- anon key -- public-safe, already in the vault, already sent as `apikey` --
-- keeps `verify_jwt: true` and leaves both checks in force, for one more
-- header.
--
-- The SERVICE ROLE key is still not used here, for the reason 20260909000003
-- gives: §3 confines it to function secrets.
--
-- ROLLBACK (forward-only)
--   Re-run 20260909000003's `cron.schedule` body to drop back to `apikey`
--   alone, or `select cron.unschedule('notify-scheduler');` to stop it dead.
-- ---------------------------------------------------------------------------

-- `cron.schedule` upserts by name, so this replaces the job defined in
-- 20260909000003 rather than adding a second one. That migration is left
-- untouched: it has been applied, and migrations are forward-only.
select cron.schedule('notify-scheduler', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_function_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb)
$$);
