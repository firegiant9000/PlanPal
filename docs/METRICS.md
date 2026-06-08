# Success metrics & KPIs (Phase 3)

Concrete targets wired to instrumentation **now**, so Beta and V1 can be measured
against a baseline instead of guessed at. Product analytics flow to **PostHog**;
errors and crash-free sessions to **Sentry**.

## MVP baselines

| KPI | Definition | MVP baseline | Source |
|-----|------------|--------------|--------|
| **Activation** | New users who create ≥ 1 event within 24h of sign-up | ≥ 40% | PostHog funnel: `signed_up` → `event_created` |
| **D7 retention** | Users active 7 days after sign-up | ≥ 25% | PostHog retention on `app_opened` |
| **D30 retention** | Users active 30 days after sign-up | ≥ 12% | PostHog retention on `app_opened` |
| **Parse success rate** | Screenshot imports that extract ≥ 1 event | ≥ 80% | `screenshot_import_completed.succeeded` |
| **Push delivery** | Delivered ÷ scheduled pushes | ≥ 95% | `push_delivered` vs. scheduler logs |
| **Crash-free sessions** | Sessions without a fatal error | ≥ 99.5% | Sentry release health |

Baselines are starting lines, not goals — revisit at the Beta gate with real data.

## How it's wired

- **Event contracts** live in [`@planpal/analytics`](../packages/analytics/) as a
  typed union (`AnalyticsEvent`). Apps call `analytics.track(name, props)` with
  full type-checking, so every event feeding the funnels above has a stable name
  and shape. Add a KPI event there first, then emit it from the apps.
- **Web** (`apps/web/src/lib/observability.ts`) initializes `posthog-js` and
  `@sentry/nextjs` from env vars, on the client, guarded so a missing key is a
  no-op (local dev / CI never emit).
- **Mobile** (`apps/mobile/src/lib/observability.ts`) exposes the same analytics
  client and reads the `EXPO_PUBLIC_*` keys. The concrete native SDKs
  (`posthog-react-native`, `@sentry/react-native`) require an Expo config plugin +
  a native rebuild and are **deferred to that native step** (like the other manual
  cloud items in [BOOTSTRAP.md](BOOTSTRAP.md)); the init hook is in place to swap
  them in.

## Environment variables

Public, client-safe (see [`.env.example`](../.env.example)). PostHog project keys
are write-only ingestion keys and Sentry DSNs are publishable, so both are safe
behind the public prefix — never put a *secret* there.

```
NEXT_PUBLIC_POSTHOG_KEY / EXPO_PUBLIC_POSTHOG_KEY
NEXT_PUBLIC_POSTHOG_HOST / EXPO_PUBLIC_POSTHOG_HOST
NEXT_PUBLIC_SENTRY_DSN / EXPO_PUBLIC_SENTRY_DSN
NEXT_PUBLIC_PLANPAL_ENV / EXPO_PUBLIC_PLANPAL_ENV
```

## Manual setup (needs the PostHog / Sentry accounts)

- [ ] Create PostHog projects (or one project, env-tagged) and a Sentry project;
      record the keys/DSNs per environment.
- [ ] Populate the public vars above in each `.env.<env>` and the host's env config.
- [ ] Build the six funnels/retention/health views above in PostHog + Sentry.
- [ ] Add the Expo config plugins for native mobile Sentry/PostHog when wiring the
      native build.
