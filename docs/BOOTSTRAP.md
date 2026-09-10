# Bootstrap & developer runbook (Phase 0)

How to get PlanPal running locally, plus the manual cloud steps Phase 0 can't
automate. Tracks the Phase 0 checklist in
[MONTH_1_PLAN.md](planning/MONTH_1_PLAN.md).

## Prerequisites

- **Node 22** (`.nvmrc` pins it — `nvm use`; `package.json` `engines` and every CI job agree)
- **pnpm 9** (`corepack enable` then `corepack prepare pnpm@9.12.0 --activate`)
- **Supabase CLI 2.117.0** — optional to install; the `pnpm db:*` scripts invoke it via
  `npx --yes supabase@2.117.0` so no global install is needed. Install it
  (`https://supabase.com/docs/guides/cli`) only if you want the bare `supabase` command on your
  PATH, and match the pinned version if you do.

  **The version is pinned deliberately, and bumping it is its own PR.** An unpinned CLI changes the
  integration stack under the team with no commit to point at, and C2's generated-types drift gate
  flaps on any release that reformats `supabase gen types` output. A bump therefore: changes the
  five `pnpm db:*` scripts, `ci.yml`'s `supabase/setup-cli` version and `deploy-staging.yml`'s four
  invocations together; re-runs `supabase gen types typescript --local` and commits the resulting
  diff to `supabase/functions/_shared/database.types.ts`; and confirms `pnpm db:start` still works
  on both devs' machines. **Owner: Scott** (the backend chain). If a pinned version cannot start the
  stack on someone's machine, pin _forward_ to the next one that works on both — never back to
  `latest`.

- **Docker** (required by the Supabase local stack)

## First-time local setup

```bash
nvm use                       # Node 22
corepack enable               # provides pnpm
pnpm install                  # install the workspace (apps/* + packages/*)
cp .env.example .env          # then fill local values (see docs/SECRETS.md)
pnpm db:start                 # boot local Supabase (Docker)
pnpm db:reset                 # apply migrations + seed.sql to the local DB
```

**`apps/web` needs its own env file.** Next.js reads env from the app directory,
not the monorepo root, so the `.env` above is invisible to it and the app throws
`NEXT_PUBLIC_SUPABASE_URL is not set` on first render. Create
`apps/web/.env.local` with the local stack's values, which `pnpm db:start`
prints:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the ANON_KEY from pnpm db:start>
```

It is gitignored (`.env.*`). Restart `pnpm --filter @planpal/web dev` after
creating it — Next reads env files at startup only.

Common workspace commands (Turborepo, run from repo root):

```bash
pnpm typecheck   # type-check every package/app
pnpm lint        # lint every workspace
pnpm test        # run tests across the graph
pnpm build       # build all buildable packages
pnpm format      # prettier write
```

## Repo layout

```
apps/
  mobile/   Expo / React Native (expo-router) — implements the @planpal/ui contracts
  web/      Next.js (App Router)              — implements the @planpal/ui contracts
  api/      Supabase Edge Functions  (PLACEHOLDER — after Phase 1 OpenAPI spec)
packages/
  api-contract/   OpenAPI spec — the integration contract (Phase 1)
  types/          shared TS contract types (mobile/web/api source of truth)
  design-tokens/  color / spacing / type / radius primitives
  ui/             shared component contracts + theme (derived from tokens)
  analytics/      typed KPI event contracts + platform-agnostic client
  recurrence/     server-side recurrence engine (Phase 4 kickoff)
supabase/
  config.toml     local stack + auth provider config
  migrations/      versioned, forward-only schema changes
  seed.sql        local-only dev fixtures
docs/             this runbook, environments, secrets policy
```

As of Phase 3, `apps/web` (Next.js) and `apps/mobile` (Expo) are real scaffolds:
each renders a token-driven screen implementing the shared `@planpal/ui` contracts
(`Button`/`Text`) so the two platforms stay consistent. The API is
`supabase/functions` — Edge Functions on Deno, which is **not** a pnpm workspace
and is gated by its own `edge-functions` CI job rather than by `turbo run`.

Run the apps locally:

```bash
pnpm --filter @planpal/web dev      # Next.js on http://localhost:3000
pnpm --filter @planpal/mobile start  # Expo dev server (needs Expo Go / a simulator)
```

## Database migration strategy

> The roadmap warns schema mistakes are expensive post-Beta but never says _how_
> changes ship safely. This is that policy.

1. **Versioned & forward-only.** Every change is a new timestamped file in
   `supabase/migrations/`. Never edit a migration that has been applied to any
   shared environment — fix forward with a new migration.
2. **Author locally.** Make the change against the local stack, then capture it:
   ```bash
   supabase db diff -f <short_description>   # generates the migration file
   pnpm db:reset                             # verify it applies cleanly from scratch
   ```
3. **Review.** Open a PR; both devs review (the plan requires both-dev sign-off
   on the `events`/recurrence design specifically). CI runs typecheck/tests.
4. **Promote.** `supabase db push` to **dev** → **staging** (auto on merge) →
   **prod** (gated). Same migration files, applied in order, everywhere.
5. **Rollback path.** Prefer a forward "down" migration that reverses the change
   (drop the column/policy you added). For destructive changes, take a Supabase
   backup before applying to prod, and document the manual reversal in the PR.
   Test the reversal against staging before prod.
6. **RLS by default.** Every new table must `enable row level security` and
   define explicit policies before any client can reach it — the baseline
   migration already revokes blanket grants so unprotected tables are
   unreachable. (Privacy is zero-tolerance — see the Beta gate.)

### Core-schema (Phase 2) reversal

`20260607120000_core_schema.sql` is reversed by a single forward "down"
migration that drops its objects in dependency order:

```sql
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.friend_connections, public.friend_codes,
  public.events, public.devices, public.notification_preferences,
  public.users cascade;   -- cascade removes their triggers/policies/indexes
drop function if exists public.generate_friend_code(),
  public.events_derive_utc(), public.set_updated_at();
drop type if exists public.friend_connection_status, public.visibility;
```

`public.users.id` FK-cascades from `auth.users`, so this is destructive — take a
Supabase backup before prod and test the reversal on staging first.

## Backup and restore

> MVP gate #7's evidence is "a completed test restore, dated". This section records
> the posture per environment, the rehearsal procedure, and the dated result.

### Posture per environment

**`planpal-dev` has no restorable automated backup.** Verified 2026-09-08 with
`supabase backups list --project-ref dhsfivkumctnstziokmu`:

```json
{ "region": "us-east-1", "walg_enabled": true, "pitr_enabled": false, "backups": [] }
```

`pitr_enabled` is false and `backups` is empty, so there is nothing to restore from
on dev today. `walg_enabled: true` is the platform's own WAL-G flag and is present
regardless — it is not evidence of a retained backup. This is consistent with the
free tier (no automated backups; PITR is a Pro add-on), but **the API does not name
the tier, so treat "free tier" as inferred rather than confirmed.**

| Environment       | Automated backups                    | PITR        | Manual dump        |
| ----------------- | ------------------------------------ | ----------- | ------------------ |
| local             | n/a — recreate with `pnpm db:reset`  | n/a         | n/a                |
| `planpal-dev`     | **none** (verified 2026-09-08)       | off         | the only option    |
| `planpal-staging` | not provisioned yet                  | —           | —                  |
| `planpal-prod`    | **required before external testers** | recommended | insufficient alone |

**Open item for the Month 4 readiness review (I1):** dev's only backup is a manual
`supabase db dump`, and the rehearsal below proves that dump is **not** a complete
backup. `planpal-prod` needs Pro-tier daily backups before external testers are let
in; gate #7 is not honestly closable on a tier that retains none.

### What `supabase db dump` does not capture

**The `on_auth_user_created` trigger is lost.** The dump carries
`public.handle_new_user()` and its grants, but the trigger attaching it lives on
`auth.users`, and `supabase db dump` excludes the Supabase-managed schemas. A
database restored from the dump accepts signups that **silently create no
`public.users`, `notification_preferences` or `friend_codes` rows** — a missing
profile row rather than an error. Confirmed by control: the trigger is present on
both the local stack and `planpal-dev`, and absent after restore.

Anything else living in a managed schema (`auth`, `storage`, `realtime`) is lost
the same way. A dump is a _schema and data_ export, not a backup.

### Rehearsal procedure

1. `supabase backups list --project-ref <ref>` — record the tier posture first.
2. Dump schema and data to a scratch directory **outside the repo** (`dump.sql` and
   `dump-data.sql` are **not** in `.gitignore`; writing them to the repo root makes
   `git status` dirty):
   ```bash
   supabase db dump --linked -f <scratch>/dump.sql
   supabase db dump --linked --data-only -f <scratch>/dump-data.sql
   ```
3. Create a scratch database and the scaffolding the dump assumes exists. The dump
   references exactly two managed objects — `auth.uid()` (24 RLS policy uses) and
   `auth.users` (one FK) — plus the `extensions` and `vault` schemas. Roles
   (`anon`, `authenticated`, `service_role`) are cluster-scoped and already exist.
4. Load `dump.sql`, then re-attach the signup trigger (see above):
   ```sql
   create trigger on_auth_user_created after insert on auth.users
     for each row execute function public.handle_new_user();
   ```
5. Verify — counts alone are not enough, and on an empty database they prove
   nothing at all:
   - Row counts per public table, both sides.
   - RLS enabled and policy count per table, both sides.
   - `grants.test.ts` against the restore:
     `SUPABASE_DB_URL=<scratch url> pnpm -C supabase/tests exec vitest run src/grants.test.ts`.
6. Delete the dumps.

### Manual steps the restore needs (every one, including the obvious)

- **`pg_cron` cannot be created** in any database but `postgres`
  (`ERROR: can only create extension in database postgres`). On a real restore the
  platform provides it; on a scratch database the schedule does not come back and
  `20260909000003_enable_notify_cron.sql` must be re-applied.
- **`publication "supabase_realtime" does not exist`** — the publication is
  platform-owned, so the dump's `ALTER PUBLICATION` fails. Recreate it before
  expecting realtime to work.
- **Re-attach `on_auth_user_created`** (step 4). Without it signups break silently.
- **`--data-only` restores need `--disable-triggers`.** `pg_dump` warns of circular
  foreign-key constraints on `events`; a data-only load can fail without it.

### Rehearsal result — 2026-09-08

| Field            | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Source           | `planpal-dev` (`dhsfivkumctnstziokmu`), Postgres 17.6.1.166           |
| Target           | scratch database `planpal_restore_test` in the local container        |
| Duration         | **7m07s** wall clock (00:11:45Z → 00:18:52Z), excluding investigation |
| Dump sizes       | `dump.sql` 51 KB · `dump-data.sql` 5 KB                               |
| Row counts       | 7/7 public tables matched — **all zero on both sides**                |
| RLS              | 7/7 tables `relrowsecurity = true`, matching dev                      |
| Policies         | 12 total, matching dev table-for-table (4/4/1/1/1/1/0)                |
| `grants.test.ts` | **20/21** on first load → **21/21** after re-attaching the trigger    |

**The row-count comparison passed vacuously and is not evidence.** Every public
table on dev is empty, so 0 = 0 on both sides. The assertions that carried real
signal were the structural ones, and they were checked for detection power: dropping
`users_select_self_or_friends` from the restore made the policy comparison report
3 against dev's 4, and re-loading the dump returned it to 4.

**The data path is therefore unproven.** `dump-data.sql` contains exactly one
statement — an `INSERT` into `storage.buckets` — and no application rows. Re-run
this rehearsal against an environment that holds real data before relying on it;
until then it demonstrates that _schema, grants and policies_ survive, and nothing
about data.

## Manual cloud steps (cannot be automated from this repo)

These need your Supabase / provider accounts. See [ENVIRONMENTS.md](ENVIRONMENTS.md)
for detail.

- [ ] Create `planpal-dev`, `planpal-staging`, `planpal-prod` Supabase projects.
- [ ] Enable email/password + Google + Apple auth in each; set redirect URIs.
- [ ] `supabase link` + `supabase db push` to each environment.
- [ ] Stand up the secrets store and enter per-environment secrets
      ([SECRETS.md](SECRETS.md)).
- [ ] Verify `avatars` (public) and `screenshots` (private) buckets exist after
      the first push.

## Phase 0 status

Repo-side scaffolding is complete (monorepo, shared types, design tokens,
Supabase config/migrations/RLS-as-code, env + secrets docs). The remaining
Phase 0 exit items are the manual cloud + secrets-store steps above.

## Phase 2 status

Core schema is authored in `20260607120000_core_schema.sql` (users,
notification_preferences, devices, events with master-rule + exceptions,
friend_codes, friend_connections) with derived-UTC + new-user-bootstrap triggers,
owner-scoped RLS, and local seed fixtures. **Pending the Phase 2 exit gate:**
both-dev review of the `events`/recurrence design, then apply to dev + staging
(`pnpm db:reset` locally → `pnpm db:push`). Friend visibility / sensitive-public
redaction and friend-by-code lookup are deferred to SECURITY DEFINER RPCs (M2/Phase 4
endpoint work), not exposed via RLS.

## Phase 3 status

App scaffolds, quality gates, and observability foundations are in place:

- **Scaffolds** — `apps/web` (Next.js App Router) and `apps/mobile` (Expo +
  expo-router) implement the shared `@planpal/ui` contracts against the design
  tokens. The web app is build-verified (`next build` green); the mobile app
  type-checks and is wired for `expo start` (a device/simulator is needed to run it).
- **CI/CD** — `.github/workflows/ci.yml` runs `lint` + `typecheck` + `test` +
  `build` on every PR. `deploy-staging.yml` auto-promotes `main` to staging
  (Supabase migrations + web deploy); its external steps are guarded on secrets so
  it stays green until the cloud accounts are wired (see ENVIRONMENTS.md).
- **Tooling** — flat-config ESLint and Vitest are installed workspace-wide (this
  fixed a pre-existing broken `lint` script that referenced an uninstalled ESLint).
- **Tests & KPIs** — strategy + coverage bar in [TESTING.md](TESTING.md); KPI
  baselines + analytics wiring in [METRICS.md](METRICS.md). The typed event
  contracts live in `@planpal/analytics`.

**Native mobile observability is wired (T24).** `@sentry/react-native` and
`posthog-react-native` are installed, both Expo config plugins are declared in
`apps/mobile/app.json`, and `src/lib/observability.ts` initialises each one
guarded on its key — `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_POSTHOG_KEY`.
With neither set the app runs silently, which is what a local run should do.

**Not yet proven, and it cannot be proven from this repo:** a config plugin only
takes effect in a NATIVE build, so nothing here has been observed reaching
Sentry or PostHog. That check belongs to the dev-client build (T25-Android), and
until it happens "crash-free sessions" has no measured baseline on mobile.

**Still manual (needs accounts, like the Phase 0 cloud steps):** the GitHub
secrets for staging deploy, and the PostHog/Sentry projects themselves — without
those there is no DSN and no key, so the guards above simply stay closed.
