# Environments

PlanPal runs **three fully separate Supabase projects** — one per environment.
Sharing a single project across environments will bite us later (the plan flags
"environment bleed" as a Month 1 risk), so separation is enforced from day 1.

| Environment | Purpose | Supabase project | Deploy trigger |
|-------------|---------|------------------|----------------|
| **dev** | Day-to-day development; throwaway data | `planpal-dev` | manual / local |
| **staging** | Prod-like integration + QA; auto-deploy target | `planpal-staging` | auto on merge to `main` (Phase 3 CI) |
| **prod** | Live users | `planpal-prod` | manual, gated release |

Local development uses the **Supabase CLI local stack** (`pnpm db:start`), which
is a fourth, disposable environment on your machine — it never touches a cloud
project.

**Backup posture** (verified 2026-09-08; see
[BOOTSTRAP.md](BOOTSTRAP.md#backup-and-restore) for the rehearsal and its findings):

- **local** — no backups by design; recreate from scratch with `pnpm db:reset`.
- **dev** (`planpal-dev`) — **no automated backups and PITR off**, confirmed by
  `supabase backups list` returning an empty `backups` array. The only backup is a
  manual `supabase db dump`, which does **not** capture the `on_auth_user_created`
  signup trigger and so is not a complete backup.
- **staging** (`planpal-staging`) — not provisioned yet; decide its tier when it is.
- **prod** (`planpal-prod`) — must be on a tier with daily automated backups (PITR
  recommended) **before external testers are admitted**. A manual dump is not
  sufficient evidence for MVP gate #7.

## Provisioning a cloud environment (manual — needs your Supabase account)

These steps require Supabase credentials and cannot be automated from the repo.
Repeat for **each** of dev / staging / prod:

1. Create the project in the Supabase dashboard (`planpal-<env>`), choosing a
   region close to users. Record the project ref.
2. Enable Auth providers: **email/password**, **Google**, **Apple**.
   - Add the env's OAuth redirect URIs (web app URL + `planpal://` deep link).
3. Confirm the `avatars` and `screenshots` storage buckets exist after the first
   migration push (they are created by the baseline migration).
4. Link the repo and push schema:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push        # applies supabase/migrations/* to this environment
   ```
5. Populate that env's secrets (see [SECRETS.md](SECRETS.md)) into the secrets
   store and the corresponding `.env.<env>` file.

## Promotion flow

```
local (CLI)  ──►  dev  ──►  staging  ──►  prod
   (manual)      (manual)   (auto on merge)   (gated manual release)
```

Migrations flow forward only. Every schema change is a new versioned migration
file (never edit an applied one) — see [BOOTSTRAP.md](BOOTSTRAP.md#database-migration-strategy).

## Observing `/healthz`'s 503 locally

`GET /healthz` answers `503` with the standard error envelope when its Postgres
round-trip fails (`openapi.yaml` declares both statuses). Inducing that inside
the integration suite is not worth the container gymnastics, so it is a manual
check:

```
docker stop supabase_rest_planpal
curl -H "apikey: <local anon key>" http://127.0.0.1:54321/functions/v1/healthz
  -> HTTP 503  {"ok":false,"error":{"code":"INTERNAL_ERROR","message":"Service unhealthy: database."}}
docker start supabase_rest_planpal
```

**Stop PostgREST, do not `docker pause supabase_db_planpal`.** A paused
container leaves its TCP connections open but unanswered, so the round-trip
hangs instead of failing — verified 2026-09-08: the probe returned nothing at
all for 25 s rather than a 503. That is worth knowing about the real failure
mode too: an uptime checker sees a timeout, not a 503, when Postgres is
reachable-but-wedged.

`version` in the `200` body is the deployed commit SHA, read from the
`PLANPAL_VERSION` function secret once per isolate. Locally the secret is unset
and the field reads `unknown`, which is the deliberate fallback — the deploy
workflow's smoke check is what requires it to equal the commit being deployed.

## Client vs. server variables

- `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` are compiled into client bundles → only the
  Supabase URL and **anon** key. Never put a secret behind a public prefix.
- `SUPABASE_SERVICE_ROLE_KEY` and all provider secrets are server-only.
