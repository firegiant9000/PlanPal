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
| `ANTHROPIC_API_KEY` | parse pipeline (Beta) | server | ❌ never | 90 days + on compromise; set spend alerts |
| `MS_GRAPH_CLIENT_*` / `_TENANT_ID` | Outlook sync (V1) | server | ❌ never | 180 days |
| `SNAP_CLIENT_ID` / `_SECRET` | Snap share (V1) | server | ❌ never | 180 days |
| `SENTRY_DSN` | all | mixed | ⚠️ DSN is low-sensitivity | on compromise |
| `*_POSTHOG_KEY` | all | client | ✅ project API key | on compromise |

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
