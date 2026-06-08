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

## Client vs. server variables

- `EXPO_PUBLIC_*` / `NEXT_PUBLIC_*` are compiled into client bundles → only the
  Supabase URL and **anon** key. Never put a secret behind a public prefix.
- `SUPABASE_SERVICE_ROLE_KEY` and all provider secrets are server-only.
