# Cross-cutting tasks — implementation plan (M5)

> **Status 2026-09-29: DEFERRED** with the rest of the Month 5 UI (see [planning/DEVELOPMENT_PLAN.md](planning/DEVELOPMENT_PLAN.md) R2). Exception: the manual Anthropic console spend alert is cheap insurance and can be set any time; it is OPTIONAL, not blocked.

**Derived from:** [MONTH5.md](MONTH5.md), "Cross-cutting tasks (starting M5)". That section names four
line items under two headings, owned by "Both"; this doc splits them by what can actually be
implemented as code versus what is an operational/console action nobody but a human with account
access can take, then plans the code-native ones.
**Audience:** an engineer or agent who has not seen this section before.

---

## Splitting the section: code vs. ops

| Item                                                      | Nature                                       | This plan                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Claude API daily spend alert (Anthropic console)          | Manual — requires Anthropic console access   | Documented as an outstanding action, not implementable here                                                |
| Monthly infra budget line (Supabase/Upstash/Textract)     | Manual — a finance/ops budget line, not code | Documented as an outstanding action                                                                        |
| **Spend kill-switch** (503 on new jobs above a threshold) | Code                                         | ✅ **Implemented** — see below                                                                             |
| **In-app feedback channel**                               | Code                                         | ✅ **Implemented** (backend + client + form component; not wired into either app's navigation) — see below |
| Triage SLA for the closed beta                            | Manual — a process/policy decision           | Documented as an outstanding decision                                                                      |

Three of the five items are not something an agent can "implement" — there is no repository change
that sets a spend alert in someone else's Anthropic console or writes a budget line into a finance
tool. Marking those "done" would be dishonest. They're listed at the bottom of this doc as an
explicit action list instead.

---

## Task 1 — Spend kill-switch ✅ Complete

MONTH5.md: "a threshold above which new parse jobs are rejected with a `503 SERVICE_UNAVAILABLE`
until reset."

### Design decisions

- **Priced today: Claude only.** `parse-worker` calls Claude Haiku 4.5 twice per job (OCR, then
  extraction) and optionally falls back to Textract for low-confidence images. Claude is priced
  from `response.usage.{input_tokens,output_tokens}` against current published per-token rates
  ($1.00/$5.00 per MTok, input/output). Textract is **not** priced — this codebase has no sourced,
  current AWS Textract per-page rate to attach a dollar figure to, and fabricating one would make
  the kill-switch's threshold meaningless. Since every job calls Claude at least once and Textract
  only runs on top of that (the fallback path, not instead of it), pricing Claude alone still makes
  the switch meaningful. Adding Textract pricing is a follow-up once confirmed against the AWS
  console/billing.
- **Rolling 24h window, not a calendar day.** MONTH5.md says "until reset" — rather than build a
  separate reset action (an admin endpoint, a scheduled counter clear), the ledger is summed over a
  trailing 24h window, exactly like the existing per-user rate limit in `parse/index.ts`. Spend
  "resets" as old rows age out of the window on their own. One fewer moving part, and it reuses a
  pattern already proven in this codebase.
- **Off by default.** `PARSE_DAILY_SPEND_LIMIT_USD` unset (or non-numeric/non-positive) disables the
  switch entirely. A safety feature that silently activates itself with no threshold anyone chose
  would be worse than not having it — every environment without this var set keeps working exactly
  as before.
- **Fails open.** A DB error reading the ledger, or missing service-role credentials in
  `handleCreateJob`, is treated as "not capped," the same posture `isRateLimited` already takes
  toward its own DB errors. An infrastructure hiccup in the cost-monitoring code must not take the
  whole upload flow down — that would make the monitoring more dangerous than the thing it watches.
- **Checked before the per-user rate limit**, in both `POST /parse/upload-url` and `POST /parse`: a
  global "we are pausing all scans" condition is logically prior to a per-caller one.

### What was built

**`supabase/migrations/20260915000001_parse_spend_ledger.sql`**
`parse_spend_ledger` table: `id, job_id (FK parse_jobs), provider ('claude'), stage ('ocr' |
'extraction'), cost_usd numeric(10,6), created_at`. RLS enabled with **no** grants and **no**
policies — unlike `parse_jobs` (owner-only RLS), this is internal ops data with zero end-user
access; only the service role (which bypasses RLS) can touch it. Indexed on `created_at` for the
trailing-24h sum.

**`supabase/functions/_shared/spend.ts`** (new)

- `claudeCostUsd(usage)` — pure function, `{input_tokens, output_tokens}` → dollars.
- `recordClaudeSpend(admin, jobId, stage, usage)` — inserts one ledger row. Non-fatal on error
  (logged and swallowed), the same posture `parse-worker` already takes toward its push
  notification: a monitoring write must never break the pipeline it's observing.
- `isSpendCapped(admin)` — the kill-switch predicate described above.

**`supabase/functions/parse-worker/index.ts`** (modified)

- `runClaudeOcr` and `runExtraction` now return the Anthropic response's `usage` alongside their
  existing results (`usage: null` from `runExtraction` only on its no-Claude-call short circuit,
  when `ocrText` is empty).
- Both call sites call `recordClaudeSpend` right after the Claude call completes.

**`supabase/functions/parse/index.ts`** (modified)

- Extracted a `makeAdminClient()` helper (previously the service-role client was constructed inline
  only in `handleCreateUploadUrl`); `handleCreateJob` did not have service-role access before and
  now optionally does, solely to read the spend ledger.
- Both `handleCreateUploadUrl` and `handleCreateJob` call `isSpendCapped` and return `503` with code
  `SERVICE_UNAVAILABLE` when tripped.

**`packages/api-contract/openapi.yaml`** (modified)

- Added `SERVICE_UNAVAILABLE` to the `ErrorCode` enum (previously absent — even `/healthz`'s
  existing `ServiceUnavailable` response documented itself as carrying `INTERNAL_ERROR`, not
  `SERVICE_UNAVAILABLE`, so this was a real gap, not a rename).
- Added a new `SpendCapped` reusable response — deliberately distinct from the existing
  `ServiceUnavailable` response (which is `/healthz`-specific: an unhealthy dependency, not a
  deliberate pause) — and referenced it as `'503'` from both `POST /parse/upload-url` and
  `POST /parse`.
- Regenerated `packages/types` and `supabase/functions/_shared/contract-types.ts`; both typecheck
  clean, and `redocly lint` (`pnpm contract:validate`) passes.

**`supabase/functions/_shared/database.types.ts`** (modified) — added the `parse_spend_ledger` table
type (Row/Insert/Update/Relationships), alongside `parse_jobs`.

**`.env.example`** / **`docs/SECRETS.md`** (modified) — documented `PARSE_DAILY_SPEND_LIMIT_USD`:
unset by default, not itself a secret but a budget control worth treating like an ops decision.

### Verified

- `pnpm contract:validate` (redocly lint) — passes.
- `turbo run typecheck` for `@planpal/types` and `@planpal/api-client` — clean, `SERVICE_UNAVAILABLE`
  correctly appears in the generated `ApiErrorCode` union.
- Manual review of both edited Edge Functions (no Deno toolchain available in this environment to
  run `deno check`/`deno lint` — the same gap the `deno.json` comment already names for CI). No
  existing integration test suite covers `/parse` yet (`supabase/tests/src` has no `parse.test.ts`),
  so this is unverified against a live stack; that gap predates this change.

### Not done here

- Textract cost pricing (see design decision above).
- A database-side `sum()` aggregate for the ledger query — `isSpendCapped` sums client-side, which
  is fine at this product's scale (at most 2 rows per job, jobs already rate-limited to 15/user/day)
  but should move to an RPC or materialized view if that stops being true.

---

## Task 2 — In-app feedback channel ✅ Complete (backend + client + form; not wired into navigation)

MONTH5.md: "In-app feedback channel" + "Triage SLA for the closed beta period."

### Design decisions made while implementing (deviations from the original sketch above)

- **RLS grants SELECT too, not insert-only.** The original sketch called for insert-only RLS with
  "no select/update grant to end users." Building it surfaced two reasons that doesn't work:
  Postgres requires `SELECT` privilege on any column read back via `INSERT ... RETURNING`, and the
  rate limit below needs a `count`-by-user query, which is itself a `SELECT`. So the policy set is
  owner-scoped `SELECT` + `INSERT` (mirroring `parse_jobs`'s `for all` pattern, minus `UPDATE`/
  `DELETE`, which end users never get). The privacy goal survives fully: a user can see only their
  _own_ submitted feedback, never anyone else's, and can never edit or delete one after sending it —
  triage still only ever happens via the service role, which bypasses RLS.
- **The response returns the created row**, not `EmptyResult` — `{ id, message, createdAt }` — once
  `SELECT` was already granted for the reasons above, returning nothing would have thrown away
  information the client can use for free (mirrors `DevicesResource.register`'s "return the
  resource, not void" correction, cited in `FeedbackResource`'s own doc comment).
- **Rate-limited to 20 submissions per user per 24h**, the same rolling-window row-count pattern as
  `parse/index.ts`'s `isRateLimited` (and the same "allow on DB error" fail-open posture) — the
  plan only said "consider" this; built it since spam protection is cheap once the pattern already
  exists in the codebase.

### What was built

**`supabase/migrations/20260915000002_feedback.sql`** — `feedback` table: `id, user_id (FK users),
message text (1–2000 chars, checked), context jsonb null, status ('new' default, for future triage
tooling), created_at`. RLS: owner-scoped `SELECT` + `INSERT` only, granted to `authenticated`. Index
on `(user_id, created_at desc)` for the rate-limit query.

**`supabase/functions/feedback/index.ts`** (new) — single `POST /feedback` route: validates
`message` (non-empty, ≤2000 chars) and `context` (must be a JSON object if present, not deeply
validated), rate-limits, inserts, returns the created row. Same shape as `parse/index.ts`
(`Deno.serve`, `getUserClient`, `readJsonObject`, `ok`/`err`).

**`packages/api-contract/openapi.yaml`** — new `feedback` tag; `FeedbackCreate`, `Feedback`,
`FeedbackResult` schemas; `POST /feedback` path (`400`/`401`/`429` responses). Regenerated
`packages/types` and `contract-types.ts`; `redocly lint` passes.

**`packages/api-client/src/resources/feedback.ts`** (new) — `FeedbackResource.create(input)`,
wired into `PlanPalClient` as `.feedback`. One test (`feedback.test.ts`) asserting the route/verb/
body against a stubbed `fetch`, mirroring `http.test.ts`'s style.

**`apps/mobile/src/components/feedback/FeedbackForm.tsx`** /
**`apps/web/src/components/feedback/FeedbackForm.tsx`** (new) — self-contained form (no API call
inside, matching `CreateEventForm`'s convention): a message textarea + Send/Cancel, `onSubmit`
receives `{ message }` already trimmed and validated non-empty. The wrapping screen (not built —
see below) would attach `context` and call `planpalClient.feedback.create(...)`.

### A testing-environment gap this surfaced

Mobile's `FeedbackForm.test.tsx` is the **first test in this codebase to drive a controlled
`TextInput` via `fireEvent.changeText`** and read the result back. Doing so surfaced that
`fireEvent.changeText` returns a promise in the installed `@testing-library/react-native` 14 /
React 19 combination, and skipping the `await` leaves every following query reading the
pre-change tree — silently, with no error. `Button.test.tsx`'s existing comment already flags
`render` as async for the same React-19-concurrent-rendering reason; `fireEvent` needing the same
treatment wasn't documented anywhere before this. Fixed by awaiting `fireEvent.changeText` (see the
test file's `typeMessage` helper and its doc comment) — worth knowing before writing the next
mobile test that types into a field and then asserts on the result.

### Verified

- Mobile: 4/4 new tests pass (`jest`); full suite (44 tests) green.
- Web: 4/4 new tests pass (`vitest`).
- `packages/api-client`: 61/61 tests pass, including the new `feedback.test.ts` and the unaffected
  §15 lint-boundary test.
- `turbo run typecheck lint` clean across `@planpal/types`, `@planpal/api-client`, `@planpal/mobile`,
  `@planpal/web`.
- `pnpm contract:validate` (redocly lint) passes.
- Manual review only for `supabase/functions/feedback/index.ts` — no Deno toolchain in this
  environment, same gap noted for Task 1.

### Not done here

- **Wiring into navigation.** Neither app has a reachable entry point to `FeedbackForm` yet (no
  Settings screen in either app, per `docs/M5_UPLOAD_UX_PLAN.md`). The component is built and
  tested ahead of the screen that will reach it, the same order this session used for
  `ParseResource.upload`, `pollJob`, and `PrivacyDisclosure`.
- **A triage surface.** Rows land in `feedback` with `status: 'new'` and are readable today only via
  the Supabase dashboard (or a future admin tool) using the service role. Nothing here builds that
  tool.
- **The triage SLA itself** — see the outstanding manual actions below; it's a process decision, not
  code, and ideally lands before the channel is actually reachable by users.

---

## Outstanding manual actions (not implementable from this repository)

- **Set a daily spend alert in the Anthropic console** for the API key `ANTHROPIC_API_KEY` points
  at. `docs/SECRETS.md`'s row for that key already carries a "set spend alerts" rotation note — this
  has been an open action since that row was written, not a new one. Requires Anthropic console
  access an agent does not have.
- **Establish a monthly infra budget line** covering Supabase, Upstash, and Textract spend. A
  finance/ops decision, not a code change.
- **Decide the triage SLA** for the closed beta period (e.g., "acknowledge within 24h, respond
  within 3 business days") — a product/process decision that should be made before Task 2's
  feedback channel goes live, since a channel nobody commits to reading on a cadence is worse than
  no channel (it sets an expectation of being heard and then doesn't meet it).
