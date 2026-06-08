# @planpal/api-contract

The PlanPal **integration contract** — a single OpenAPI 3.1 document
([`openapi.yaml`](openapi.yaml)) describing every endpoint shape, request body,
response, and error code. This is the Phase 1 deliverable from
[MONTH_1_PLAN.md](../../MONTH_1_PLAN.md): the spec is agreed **before** any API
coding, and it is the unblocker for both the consumer (mobile/web) and backend
work.

> Standing rule (DEVELOPMENT_PLAN.md): the OpenAPI spec is the contract — keep it
> current. Any endpoint change lands here first, in the same PR.

## What's in the contract

- **Envelope** matching `@planpal/types`: success `{ ok: true, data }`, failure
  `{ ok: false, error: { code, message, details? } }`, cursor pagination
  `{ items, nextCursor }`.
- **Auth** is Supabase-managed (email/password, Google, Apple). There are no auth
  endpoints here — every route expects `Authorization: Bearer <supabase-jwt>`.
- **Profile / account** (`/me`), incl. GDPR account deletion.
- **Notifications** — preferences + Expo push-token registration (drives the M2
  scheduler).
- **Events** — master-rule + exceptions CRUD, per-occurrence override/cancel
  (`THIS` scope), and **server-side occurrence expansion** (`GET /occurrences`).
  The client never expands RRULEs.
- **Friends** — 8-char codes (rotate, 30-day expiry), requests (mutual consent,
  no directory, rate-limited), connections, block/report, and the
  **server-redacted** Friends view (`GET /friends/{userId}/occurrences`).
- **Export** — iCal.

### Modeling notes (why the wire shape ≠ the DB shape)

- The DB stores recurrence as **master + exception rows** (`master_event_id`,
  `recurrence_exception_date` — Phase 2). The contract hides that: consumers see a
  clean `Event` (master/standalone), occurrence-override endpoints, and a read-only
  expanded `EventOccurrence`. The mapping is documented inline in the spec.
- **Timezone:** `localStart` + `timezoneId` is the source of truth; `utcStart` /
  `utcEnd` are `readOnly` (server-derived) and used for indexing/conflict detection.
- **Privacy:** `sensitive_public` is redacted **server-side at query time** in
  `FriendOccurrence` (`redacted: true`, sensitive fields stripped) — a compromised
  client can never receive hidden data.

## Error codes

`code` is stable and machine-readable. Current set and their HTTP mapping:

| code                  | HTTP | Meaning                                                                 |
| --------------------- | ---- | ----------------------------------------------------------------------- |
| `validation_error`    | 400  | Request body/params failed validation (`details` carries field errors). |
| `unauthenticated`     | 401  | Missing/invalid access token.                                           |
| `forbidden`           | 403  | Authenticated but not permitted.                                        |
| `not_found`           | 404  | Resource missing or not visible to caller.                              |
| `conflict`            | 409  | Generic state conflict.                                                 |
| `already_friends`     | 409  | Connection already exists.                                              |
| `request_pending`     | 409  | A friend request is already pending.                                    |
| `friend_code_invalid` | 400  | Code not recognized.                                                    |
| `friend_code_expired` | 400  | Code is past its 30-day expiry.                                         |
| `recurrence_invalid`  | 400  | RRULE could not be parsed/expanded.                                     |
| `timezone_invalid`    | 400  | Not a valid IANA timezone id.                                           |
| `rate_limited`        | 429  | Per-account rate limit hit (`Retry-After` header).                      |
| `internal_error`      | 500  | Unexpected server error.                                                |

## Deferred (added when their phase begins)

Not designed in Phase 1, to avoid speculative contracts:

- **Screenshot-to-schedule parsing** (Beta M5): upload + parse-job lifecycle + review.
- **Calendar-export integrations** (V1): Google/Outlook one-way push, shareable links.
- **Outbound social share** (V1): Instagram / Snapchat / Discord (mostly client-side).

## Lint & codegen (wired)

Spec linting (`@redocly/cli`) and type generation (`openapi-typescript`) are
wired (deps approved). `@planpal/types` defers domain models so they are
**generated** from this spec — single source of truth, no drift.

```bash
pnpm contract:validate     # redocly lint openapi.yaml
pnpm contract:generate     # → packages/types/src/generated/openapi.ts
```

- The generated file is **committed**; do not hand-edit it. Consumers import
  domain models via `@planpal/types` (ergonomic aliases re-exported from
  `packages/types/src/contract.ts`).
- `pnpm build` regenerates as part of the Turborepo graph (`@planpal/types`
  depends on this package's `build`).
- CI ([`.github/workflows/contract.yml`](../../.github/workflows/contract.yml))
  lints the spec, regenerates, and **fails on drift** — so a spec change without a
  committed regen is caught in review. Pin the lint ruleset in
  [`redocly.yaml`](redocly.yaml).
