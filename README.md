# PlanPal

Calendar app with AI screenshot import and a one-way social sharing layer.
Expo (mobile) + Next.js (web) + Supabase, in a pnpm/Turborepo monorepo.

## Quick start

```bash
nvm use && corepack enable
pnpm install
cp .env.example .env      # fill local values — see docs/SECRETS.md
pnpm db:start && pnpm db:reset
```

Full setup, repo layout, and the migration strategy are in
[docs/BOOTSTRAP.md](docs/BOOTSTRAP.md).

## Docs

- [Development plan](DEVELOPMENT_PLAN.md) · [Month 1 plan](MONTH_1_PLAN.md)
- [Bootstrap & runbook](docs/BOOTSTRAP.md)
- [Environments](docs/ENVIRONMENTS.md)
- [Secrets & rotation policy](docs/SECRETS.md)
- [Test strategy](docs/TESTING.md)
- [Metrics & KPIs](docs/METRICS.md)

## Layout

```
apps/web                Next.js (App Router) — build-verified scaffold
apps/mobile             Expo / React Native (expo-router) scaffold
packages/api-contract   OpenAPI spec — the integration contract (Phase 1)
packages/types          shared TS contract types
packages/design-tokens  design system primitives
packages/ui             shared component contracts + theme
packages/analytics      typed KPI event contracts + client
packages/recurrence     server-side recurrence engine (Phase 4 kickoff)
supabase/functions      the API — Edge Functions (Deno), not a pnpm workspace
supabase/               local config, migrations, RLS
```

## Develop

```bash
pnpm dev          # run all apps (Turborepo)
pnpm lint         # eslint across the workspace
pnpm typecheck    # tsc across the workspace
pnpm test         # unit/integration tests
pnpm build        # build packages + web
```

CI runs lint/typecheck/test/build on every PR; merges to `main` auto-deploy to
staging. See [Testing](docs/TESTING.md) and [Metrics & KPIs](docs/METRICS.md).
