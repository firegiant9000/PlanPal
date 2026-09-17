# Secrets management & rotation policy

PlanPal handles user schedule data and integrates with several third parties.
Secrets are never committed to git — the repo only tracks `*.example` templates.
This document is the authoritative inventory of every secret, where it lives,
who can access it, and how often it rotates.

## Where secrets live

- **Source of truth:** a managed secrets store, one logical scope per
  environment (`dev` / `staging` / `prod`). Use Supabase's project secrets for
  Edge Function runtime secrets, and a dedicated store (1Password / Doppler /
  GitHub Actions Encrypted Secrets) for CI and developer access.
- **Local dev:** a gitignored `.env` (copied from `.env.example`). Use sandbox
  / test credentials locally — never prod secrets on a laptop.
- **CI/CD:** GitHub Actions Encrypted Secrets, scoped per environment via
  GitHub Environments (Phase 3 wires this).

> ⚠️ Provisioning the secrets store and entering real values is a manual step
> requiring account access — it cannot be done from this repo. This doc defines
> the policy; an operator populates the values.

## Secret inventory

| Secret | Used by | Scope | Public-safe? | Rotation |
|--------|---------|-------|--------------|----------|
| `SUPABASE_*_ANON_KEY` | mobile, web | client | ✅ yes (RLS-gated) | on suspected compromise |
| `SUPABASE_SERVICE_ROLE_KEY` | API/server | server | ❌ never | 90 days + on compromise |
| `SUPABASE_DB_URL` | migrations | server/CI | ❌ never | 90 days |
| `SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `_SECRET` | auth | server | ❌ never | 180 days |
| `SUPABASE_AUTH_APPLE_CLIENT_ID` / `_SECRET` | auth | server | ❌ never | Apple key expires ≤6 mo — rotate before expiry |
| `UPSTASH_REDIS_REST_URL` | parse pipeline (Beta) | server | ❌ never | on compromise |
| `UPSTASH_REDIS_REST_TOKEN` | parse pipeline (Beta) | server | ❌ never | 90 days + on compromise |
| `ANTHROPIC_API_KEY` | parse pipeline (Beta) | server | ❌ never | 90 days + on compromise; set spend alerts |
| `AWS_ACCESS_KEY_ID` | parse-worker Textract fallback (Beta) | server | ❌ never | 90 days + on compromise |
| `AWS_SECRET_ACCESS_KEY` | parse-worker Textract fallback (Beta) | server | ❌ never | 90 days + on compromise |
| `AWS_REGION` | parse-worker Textract fallback (Beta) | server | ⚠️ not a secret, but env-specific | on region change |
| `PARSE_DAILY_SPEND_LIMIT_USD` | `parse` spend kill-switch (Beta) | server | ⚠️ not a secret, but a budget control — treat changes like an ops decision, not a routine config edit | review each time Claude/Textract pricing or beta volume changes |
| `MS_GRAPH_CLIENT_*` / `_TENANT_ID` | Outlook sync (V1) | server | ❌ never | 180 days |
| `SNAP_CLIENT_ID` / `_SECRET` | Snap share (V1) | server | ❌ never | 180 days |
| `SENTRY_DSN` | all | mixed | ⚠️ DSN is low-sensitivity | on compromise |
| `*_POSTHOG_KEY` | all | client | ✅ project API key | on compromise |
| `CRON_SECRET` | `notify-scheduler` + the `pg_cron` job | server | ❌ never | 90 days + on compromise |
| `notify_function_url` (vault) | the `pg_cron` job | server (in-database) | ⚠️ not a secret, but environment-specific | on project change |
| `anon_key` (vault) | the `pg_cron` job | server (in-database) | ✅ same value as the client anon key | with the project's anon key |

## Vault secrets for the scheduler

The `pg_cron` job that drives `notify-scheduler` runs **inside the database**, so
it cannot read Edge Function secrets or environment variables. It reads three
values from `supabase_vault` at each tick instead. Create them once per
environment, as an operator with dashboard access:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/notify-scheduler', 'notify_function_url');
select vault.create_secret('<anon key>', 'anon_key');
select vault.create_secret('<random 32+ chars>', 'cron_secret');
```

| Vault name                   | What it is                                      | Rotation owner |
| ---------------------------- | ----------------------------------------------- | -------------- |
| `notify_function_url`        | notify-scheduler function URL for this env      | Scott          |
| `parse_worker_function_url`  | parse-worker function URL for this env          | Scott          |
| `anon_key`                   | the project's anon key (public-safe)            | Scott          |
| `cron_secret`                | the shared secret both cron handlers check      | Scott          |

The job sends `anon_key` **twice** — once as `apikey` and once as
`Authorization: Bearer …`. The cloud gateway rejects a request carrying only
`apikey` with `401 UNAUTHORIZED_NO_AUTH_HEADER`, even though the local Kong
accepts it, so a schedule that works locally fails on every cloud environment.
See `supabase/migrations/20260909000004_notify_cron_authorization_header.sql`.

**The same `cron_secret` value must also be set as a function secret:**

```
supabase secrets set CRON_SECRET=<the same value> --project-ref <ref>
```

The handler compares the `X-Cron-Secret` request header against its own
`CRON_SECRET` env var — it never reads the vault. So the vault copy is what the
job *sends* and the function secret is what the function *expects*; rotating one
without the other gives a 403 on every tick. Rotate them together, vault first.

Values are read fresh at each tick, so the schedule can be created before the
secrets exist; until they do, each tick fails visibly rather than silently doing
nothing. **Which layer the failure lands in depends on what is wrong, and the
difference matters when diagnosing at 3am** (verified on `planpal-dev`,
2026-09-08):

| What is wrong          | `cron.job_run_details` | `net._http_response`          |
| ---------------------- | ---------------------- | ----------------------------- |
| a secret is **missing**| `failed` — `null value in column "url"` | **nothing at all** — never queued |
| a secret is **wrong**  | `succeeded`            | `403` from the handler        |
| the gateway rejects it | `succeeded`            | `401` from Kong               |

So a green `cron.job_run_details` is **not** evidence a tick worked — it only
means the job made the call. Always check both layers. On dev this was not
hypothetical: 25 consecutive `succeeded` ticks covered a stretch in which every
single request was being rejected `401` by the gateway.

> Never paste any of these values into this file, a migration, a commit message,
> or the Obsidian vault. This document records names, owners and cadence only.

## Rotation policy

1. **Cadence:** server secrets every **90 days**; OAuth/provider client secrets
   every **180 days** or before provider-imposed expiry (Apple keys expire in
   ≤6 months — calendar a reminder).
2. **Procedure (zero-downtime where supported):**
   - Generate the new secret at the provider.
   - Add it to the secrets store for the target environment.
   - Deploy/restart consumers so both old and new are briefly valid (providers
     that support dual keys: add new before revoking old).
   - Revoke the old secret.
   - Record the rotation date in the store/audit log.
3. **On suspected compromise:** rotate immediately, out of cadence; audit access
   logs; if `SUPABASE_SERVICE_ROLE_KEY` leaked, rotate it **and** review RLS.
4. **Access:** least privilege. Prod secrets restricted to the smallest set of
   people. Never paste secrets into chat, tickets, or commits.
5. **Separation:** dev / staging / prod each have their **own** distinct
   secrets — never reuse a value across environments.

## When a secret is added later

Add it to: this inventory table, `.env.example` (as an empty key with a
comment), and the secrets store for every environment that needs it.
