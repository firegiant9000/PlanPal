# Bootstrap & developer runbook (Phase 0)

How to get PlanPal running locally, plus the manual cloud steps Phase 0 can't
automate. Tracks the Phase 0 checklist in
[MONTH_1_PLAN.md](../MONTH_1_PLAN.md).

## Prerequisites

- **Node 20** (`.nvmrc` pins it — `nvm use`)
- **pnpm 9** (`corepack enable` then `corepack prepare pnpm@9.12.0 --activate`)
- **Supabase CLI** — optional; the `pnpm db:*` scripts invoke it via `npx --yes supabase@latest` so no global install is needed. Install it (`https://supabase.com/docs/guides/cli`) only if you want the bare `supabase` command on your PATH.
- **Docker** (required by the Supabase local stack)

## First-time local setup

```bash
nvm use                       # Node 20
corepack enable               # provides pnpm
pnpm install                  # install the workspace (apps/* + packages/*)
cp .env.example .env          # then fill local values (see docs/SECRETS.md)
pnpm db:start                 # boot local Supabase (Docker)
pnpm db:reset                 # apply migrations + seed.sql to the local DB
```

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

**Still manual (needs accounts, like the Phase 0 cloud steps):** the GitHub
secrets for staging deploy, the PostHog/Sentry projects, and the native-mobile
Sentry/PostHog config plugins. Native mobile observability is a no-op until that
step.
