# Month 5 — Screenshot-to-Schedule Pipeline (B1 + B2)

> **Status 2026-09-29.** Steps 1 to 8 (the server pipeline) are done and stay as they are. The four 🟡 rows (upload UX, privacy disclosure wiring, cost-monitoring UI, feedback wiring) are **DEFERRED** until sharing, the cross-user RLS proof and the recurrence differential tests (P1 to P3 in [planning/DEVELOPMENT_PLAN.md](planning/DEVELOPMENT_PLAN.md)) are done. No screen calls the pipeline today, so it processes nothing; the server-side spend kill-switch remains the cost guard. Before any upload UI ships, the privacy disclosure must be wired first, because images go to two external processors.

**Weeks 17–20 · Focus: server-side parse pipeline, end to end.**
The pipeline runs entirely server-side so the model can be upgraded without
app releases. Client sends an image; server OCRs, extracts, normalises, and
conflict-checks; client polls for results.

---

## Status overview

| Step                                             | Owner | Status                                                                                                     |
| ------------------------------------------------ | ----- | ---------------------------------------------------------------------------------------------------------- |
| Step 1 — Upload flow                             | Scott | ✅ Complete                                                                                                |
| Step 2 — OCR (Claude vision + Textract fallback) | Scott | ✅ Complete                                                                                                |
| Step 3 — LLM extraction                          | Scott | ✅ Complete                                                                                                |
| Step 4 — Normalisation                           | Scott | ✅ Complete                                                                                                |
| Step 5 — Conflict detection                      | Scott | ✅ Complete                                                                                                |
| Step 6 — Job completion (push + badge)           | Scott | ✅ Complete                                                                                                |
| Step 7 — Rate limiting (15/user/day)             | Scott | ✅ Complete                                                                                                |
| Step 8 — B2 variable-schedule detection          | Scott | ✅ Complete                                                                                                |
| Upload UX (camera roll, progress states)         | Arlo  | 🟡 In progress — see `docs/M5_UPLOAD_UX_PLAN.md`                                                           |
| Privacy disclosure notice (App Store req)        | Arlo  | 🟡 In progress — notice + persistence built, not wired                                                     |
| Cost monitoring & budget alerts                  | Both  | 🟡 In progress — see `docs/M5_CROSS_CUTTING_PLAN.md`                                                       |
| User support & feedback loop                     | Both  | 🟡 In progress — backend/client/form built, not wired into either app; see `docs/M5_CROSS_CUTTING_PLAN.md` |

---

## Step 1 — Upload flow ✅

### What was built

A two-step upload flow: the client requests a presigned URL from the server,
uploads the image directly to Supabase Storage, then submits a job. The server
enqueues the job to Upstash Redis and returns a job ID immediately. The client
polls for results.

**Three endpoints, all handled by the `parse` Edge Function:**

| Method | Path                | What it does                                                                                     |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/parse/upload-url` | Rate-checks caller, returns a presigned upload URL + storage path                                |
| `POST` | `/parse`            | Validates storage path ownership, inserts a `parse_jobs` row, enqueues to Redis, returns the job |
| `GET`  | `/parse/{jobId}`    | Returns the current state of a job                                                               |

**Rate limit:** 15 parse requests per user per 24 hours (enforced server-side
via `parse_jobs` count query; checked on both `upload-url` and `parse`).

---

### Infrastructure set up

**Upstash Redis**

- A Redis database was created at [console.upstash.com](https://console.upstash.com)
  for the `parse:queue` job queue.
- The Edge Function writes jobs via the Upstash REST API (raw `fetch` — no library).
- Credentials (`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`) are set
  as Supabase project secrets and in `supabase/functions/.env` locally.

**Supabase cloud project (`planpal-dev`)**

- Cloud project linked via `npx supabase link --project-ref <ref>`.
- All existing migrations pushed via `npx supabase db push`.
- A migration sequencing issue was discovered and fixed during push (see
  Security fixes below).

---

### Files created

**`supabase/migrations/20260909000005_parse_jobs.sql`**
Creates the `parse_jobs` table:

- `id`, `user_id`, `storage_path`, `status`, `event_count`, `error_code`,
  `created_at`, `updated_at`
- Status constraint: `queued | processing | done | failed`
- `updated_at` auto-maintained by the existing `set_updated_at()` trigger
- Covering index on `(user_id, created_at DESC)` for the rate-limit query
- Owner-only RLS (`user_id = auth.uid()`)
- `SELECT, INSERT, UPDATE` granted to `authenticated`

**`supabase/functions/parse/index.ts`**
The full Edge Function handling all three routes. Key implementation details:

- Routing via URL segment parsing (`segments[1]` = `'upload-url'` | UUID | absent)
- Uses the service role client (not the user client) to call
  `createSignedUploadUrl` — required for elevated storage permissions
- Storage path ownership validation: the first path segment must equal the
  caller's `userId` before a job is created
- Redis enqueue is non-fatal: a Redis failure returns a valid job (status
  `queued`) and logs the error; the job can be retried by a worker poll

**`packages/api-client/src/resources/parse.ts`**
`ParseResource` interface + `createParseResource(http)` factory:

- `getUploadUrl()` → `POST /parse/upload-url`
- `enqueue(input)` → `POST /parse`
- `getJob(jobId)` → `GET /parse/{jobId}`

---

### Files modified

**`packages/api-contract/openapi.yaml`**
Added the `parse` tag and six new schemas + three path entries:

- Schemas: `ParseJobStatus`, `ParseUploadUrl`, `ParseJobCreate`, `ParseJob`,
  `ParseUploadUrlResult`, `ParseJobResult`
- Paths: `POST /parse/upload-url`, `POST /parse`, `GET /parse/{jobId}`

**`packages/types/src/generated/openapi.ts`**
**`supabase/functions/_shared/contract-types.ts`**
Both regenerated from `openapi.yaml` via:

```bash
cd packages/api-contract
npx openapi-typescript openapi.yaml --output ../types/src/generated/openapi.ts
npx openapi-typescript openapi.yaml --output ../../supabase/functions/_shared/contract-types.ts
```

Run `pnpm contract:generate` from the repo root after any future change to
`packages/api-contract/openapi.yaml`.

**`packages/types/src/contract.ts`**
Added `ParseJobStatus`, `ParseUploadUrl`, `ParseJobCreate`, `ParseJob` type
aliases re-exported for TypeScript consumers.

**`packages/api-client/src/client.ts`**
**`packages/api-client/src/index.ts`**
`parse: ParseResource` added to `PlanPalClient`; `ParseResource` exported from
the package index.

**`supabase/functions/_shared/database.types.ts`**
Added `parse_jobs` table type (Row / Insert / Update / Relationships).

**`.env.example`**
Added `UPSTASH_REDIS_REST_URL=` and `UPSTASH_REDIS_REST_TOKEN=` with a comment
pointing to Upstash setup.

**`docs/SECRETS.md`**
Added `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to the secret
inventory table under the parse pipeline section.

---

### Security fixes

**`supabase/migrations/20260902000001_secdef_grant_hardening.sql`**

The §15 audit check at the end of this migration (which asserts that no
`SECURITY DEFINER` function in `public` is executable by `public / anon /
authenticated`) was catching `rls_auto_enable()` on the cloud project.

`rls_auto_enable()` is provisioned by the Supabase platform in cloud projects
and is absent from the local stack. It is invoked via a DDL event trigger;
PostgreSQL does not check `EXECUTE` privilege for event trigger dispatch, so
revoking from end-user roles is safe and has no effect on trigger firing.

Fix: a conditional `DO $$ ... IF EXISTS $$` block was added **before** the
audit check that revokes execute on `rls_auto_enable()` from `public`,
`anon`, and `authenticated` only when the function exists. This allows both
local (`pnpm db:reset`) and cloud (`npx supabase db push`) to pass the audit
gate without error.

---

## Step 2 — OCR ✅

### What was built

A background worker (`parse-worker`) that fires every minute via pg_cron,
dequeues one job at a time from `parse:queue`, and runs OCR on the uploaded
image. Claude vision is the primary OCR engine; AWS Textract runs automatically
as a fallback when Claude reports low confidence. The OCR result is stored on
the `parse_jobs` row for Stage 2 (LLM extraction) to consume.

**Flow per invocation:**

1. Validate `X-Cron-Secret` header (same pattern as `notify-scheduler`)
2. RPOP one payload from `parse:queue` (FIFO — enqueued with LPUSH)
3. Set `parse_jobs.status = 'processing'` to claim the job
4. Download image bytes from Supabase Storage via the admin client
5. Send image to Claude vision (`claude-haiku-4-5-20251001`) with a structured OCR prompt
6. If Claude responds with `confidence: "low"`, call AWS Textract `DetectDocumentText` as fallback
7. Write `ocr_text` + `ocr_provider` (`claude` | `textract`) to the job row
8. Status remains `processing` — Stages 2–5 will set it to `done`

On any error: sets `status = 'failed'` with a typed `error_code`:
`STORAGE_DOWNLOAD_FAILED`, `CLAUDE_API_ERROR`, `TEXTRACT_ERROR`,
`IMAGE_TOO_LARGE` (Textract 5 MB inline limit), `CONFIG_MISSING`, `OCR_FAILED`.

---

### Infrastructure set up

**AWS IAM**

- An IAM user was created with `AmazonTextractFullAccess`.
- An access key was generated for that user.
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` were set as Supabase project
  secrets via `supabase secrets set`. `AWS_REGION` defaults to `us-east-1`
  in the worker if not explicitly set.

**pg_cron vault entry**

- A new vault secret `parse_worker_function_url` was created in the
  `planpal-dev` project pointing to the deployed function URL.
- The worker reuses the existing `cron_secret` and `anon_key` vault entries
  (shared with `notify-scheduler`).

---

### Files created

**`supabase/functions/parse-worker/index.ts`**
The worker Edge Function. Key implementation details:

- Uses `aws4fetch` (`https://esm.sh/aws4fetch@1.0.20`) for AWS Signature V4
  signing of Textract requests — no AWS SDK required in Deno
- `toBase64()` converts image bytes in 32 KB chunks to avoid call-stack
  overflows on large images
- Claude prompt instructs the model to return `{"text":"...","confidence":"high"|"low"}`
  and strips any markdown fences Claude adds despite the instruction
- Non-JSON Claude responses are treated as high-confidence raw text
- Textract `LINE` blocks are joined with newlines in reading order

**`supabase/migrations/20260909000006_parse_jobs_ocr.sql`**
Adds two columns to `parse_jobs`:

- `ocr_text text` — raw text extracted from the image
- `ocr_provider text check (in ('claude', 'textract'))` — which engine produced it

**`supabase/migrations/20260909000007_parse_worker_cron.sql`**
Schedules `parse-worker` every minute via pg_cron using the same
`net.http_post` pattern as `notify-scheduler`. Reads `parse_worker_function_url`,
`anon_key`, and `cron_secret` from the vault at each tick.

---

### Files modified

**`supabase/functions/_shared/database.types.ts`**
Added `ocr_text: string | null` and `ocr_provider: string | null` to the
`parse_jobs` Row, Insert, and Update types.

**`docs/SECRETS.md`**

- Added `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` to the
  secret inventory table.
- Added `parse_worker_function_url` to the vault secrets table.

**`.env.example`**
Added the three AWS credential keys with a comment describing the required
IAM permission.

---

## Step 3 — LLM extraction ✅

### What was built

A second Claude call inside `parse-worker` that sends the OCR text to
`claude-haiku-4-5-20251001` and receives a structured JSON array of candidate
calendar events. The result is written to `parse_jobs.extracted_events` before
normalisation runs.

**Structured output per candidate event:**

| Field        | Type             | Description                                    |
| ------------ | ---------------- | ---------------------------------------------- |
| `name`       | `string`         | Event title, exactly as it appears in the text |
| `date`       | `string`         | Date string exactly as it appears              |
| `startTime`  | `string \| null` | Start time exactly as it appears, or null      |
| `endTime`    | `string \| null` | End time exactly as it appears, or null        |
| `location`   | `string \| null` | Location or room if present, or null           |
| `recurrence` | `string \| null` | Recurrence pattern as it appears, or null      |

Dates and times are kept verbatim from the OCR text at this stage — resolution
happens in Step 4 (normalisation).

**Failure handling:**

- Blank OCR text → returns `{ events: [], reason: 'NO_OCR_TEXT' }` (not an error)
- Claude API HTTP error → throws `ParseError('EXTRACTION_FAILED')` — retryable in Step 7
- Unparseable JSON response → returns `{ events: [], reason: 'EXTRACTION_PARSE_ERROR' }`
- No events found → returns `{ events: [], reason: 'NO_EVENTS_FOUND' }`
- All non-error paths leave the job in `processing` for the next stage

---

### Files created

**`supabase/migrations/20260910000000_parse_jobs_extraction.sql`**

```sql
alter table public.parse_jobs add column extracted_events jsonb;
```

---

### Files modified

**`supabase/functions/parse-worker/index.ts`**

- Added `CandidateEvent` type (the six fields above)
- Added `runExtraction(ocrText)` async function:
  - Returns early with an empty array if `ocrText` is blank
  - Sends the full OCR text to Claude with a structured extraction prompt
  - Strips markdown fences from the response before JSON parsing
  - Maps the raw parsed array to typed `CandidateEvent[]`
- Added intermediate `parse_jobs` write: `extracted_events = events`

**`supabase/functions/_shared/database.types.ts`**
Added `extracted_events: Json | null` to the `parse_jobs` Row, Insert, and
Update types.

---

## Step 4 — Normalisation ✅

### What was built

A synchronous normalisation pass that resolves all raw candidate events into
structured, calendar-ready data. No additional Claude calls — all work is done
locally using `chrono-node` for date parsing and the project's own recurrence
engine for RRULE validation.

**What normalisation does per event:**

1. **Date resolution** — combines `date` + `startTime` strings and parses them
   with `chrono-node@2.7.7` relative to the user's current date (at noon in
   their timezone to avoid midnight edge cases). Produces
   `startDateTime: "YYYY-MM-DDTHH:mm:ss"` (local, no offset).
2. **End time resolution** — same parse applied to `date` + `endTime` if present.
3. **Window validation** — events in the past get `PAST_DATE`; events beyond
   180 days get `OUTSIDE_WINDOW`; events that could not be parsed at all get
   `UNPARSEABLE_DATE`.
4. **Recurrence conversion** — the raw recurrence string is mapped to an RFC
   5545 RRULE via a lookup table (`toRRule`), then validated by calling
   `parseRRule()` from `_shared/recurrence`. Invalid or unrecognised patterns
   get `UNSUPPORTED_RRULE`.

**`toRRule` lookup table:**

| Input pattern                  | RRULE output                       |
| ------------------------------ | ---------------------------------- |
| `daily`, `every day`           | `FREQ=DAILY`                       |
| `weekly`, `every week`         | `FREQ=WEEKLY`                      |
| `biweekly`, `every other week` | `FREQ=WEEKLY;INTERVAL=2`           |
| `monthly`, `every month`       | `FREQ=MONTHLY`                     |
| `yearly`, `annually`           | `FREQ=YEARLY`                      |
| `weekday`                      | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR` |
| `every Monday` (etc.)          | `FREQ=WEEKLY;BYDAY=MO` (etc.)      |
| anything else                  | `null` → `UNSUPPORTED_RRULE` flag  |

**`NormalizedEvent` output shape** (extends `CandidateEvent`):

| Field                         | Type                           | Notes                                                                              |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `startDateTime`               | `string \| null`               | `YYYY-MM-DDTHH:mm:ss` local                                                        |
| `endDateTime`                 | `string \| null`               | `YYYY-MM-DDTHH:mm:ss` local                                                        |
| `recurrenceRule`              | `string \| null`               | RFC 5545 RRULE string                                                              |
| `flagged`                     | `boolean`                      | true if any flag reason is present                                                 |
| `flagReasons`                 | `string[]`                     | `PAST_DATE \| OUTSIDE_WINDOW \| UNPARSEABLE_DATE \| UNSUPPORTED_RRULE \| CONFLICT` |
| `conflictingEventIds`         | `string[]`                     | populated by Step 5; initialised `[]` here                                         |
| `variableScheduleSuggestions` | `VariableScheduleSuggestion[]` | populated by Step 8; initialised `[]` here                                         |

The user's `timezone_id` is fetched once from the `users` table before
normalisation and reused by conflict detection (Step 5) — one DB round trip
for both stages.

---

### Files created

**`supabase/migrations/20260910000001_parse_jobs_normalised.sql`**

```sql
alter table public.parse_jobs add column normalised_events jsonb;
```

---

### Files modified

**`supabase/functions/parse-worker/index.ts`**

- Added import: `* as chrono from 'https://esm.sh/chrono-node@2.7.7'`
- Added `NormalizedEvent` type extending `CandidateEvent`
- Added `VariableScheduleSuggestion` type (populated later in Step 8)
- Added `DAY_CODES` record mapping day name variants to RFC 5545 day codes
- Added `toRRule(text)` lookup function
- Added `toLocalDateTimeString(date, timezone)` using `Intl.DateTimeFormat en-CA`
  with `formatToParts` → `YYYY-MM-DDTHH:mm:ss`
- Added `runNormalisation(events, timezone)` pure synchronous function
- Added timezone fetch from `users` table (shared with Stage 4)
- Added intermediate `parse_jobs` write: `normalised_events = normalised`

**`supabase/functions/_shared/database.types.ts`**
Added `normalised_events: Json | null` to the `parse_jobs` Row, Insert, and
Update types.

---

## Step 5 — Conflict detection ✅

### What was built

An async overlap check that compares each normalised candidate event against
the user's existing calendar occurrences. Conflicting events are flagged in the
`normalised_events` array; nothing is blocked or rejected — the review UI
(Month 6) surfaces the flags.

**How it works:**

1. Collect the calendar-date portion (`YYYY-MM-DD`) of every candidate that
   has a parseable `startDateTime`.
2. Determine a `from` / `to` date range from the earliest and latest of those
   dates.
3. Fetch all of the user's `events` rows (`owner_id = userId`) — both masters
   and exceptions.
4. Map rows to `EventRecord[]` via `mapEventRow` from `_shared/recurrence`.
5. Call `expandOccurrences(records, { from, to })` — the same engine used by
   `GET /occurrences`. This is the only correct implementation; the `utc_start`
   / `utc_end` index columns are approximations and are not used here.
6. For each candidate event, convert `startDateTime` and `endDateTime` (or a
   1-hour fallback) to UTC using `localToUtc(parseLocal(...), timezone)`.
7. Overlap-check with `overlapsUtc(aStart, aEnd, bStart, bEnd)` (half-open
   interval comparison on ISO UTC strings).
8. Deduplicate conflicting master event IDs — a recurring event can produce
   multiple overlapping occurrences.
9. If any conflicts found: add `CONFLICT` to `flagReasons`, set
   `conflictingEventIds`, mark `flagged = true`.

On `expandOccurrences` failure (`UnsupportedRRuleError`, `RecurrenceRangeError`):
logs a warning and returns the normalised events without conflict flags —
graceful degradation rather than a failed job.

---

### Files modified

**`supabase/functions/parse-worker/index.ts`**

- Added imports: `expandOccurrences`, `localToUtc`, `mapEventRow`, `parseLocal`,
  `type EventRow` from `_shared/recurrence/index.ts`
- Added `overlapsUtc(aStart, aEnd, bStart, bEnd)` helper (half-open UTC interval)
- Added `addOneHour(localDatetime)` fallback end-time helper
- Added `runConflictDetection(normalised, userId, timezone, admin)` async function
- Added `conflictingEventIds: []` initialisation in `runNormalisation` return value

No new migrations — conflict flags are stored inside the `normalised_events`
JSONB column written by the final pipeline update.

---

## Step 6 — Job completion signaling ✅

### What was built

After the full pipeline completes, `parse-worker` sends an Expo push
notification to every device the user has registered. The notification carries
the event count and a `data` payload the client uses to deep-link to the review
screen.

**Push payload per device:**

| Field             | Value                                                       |
| ----------------- | ----------------------------------------------------------- |
| `title`           | `"Schedule scan complete"`                                  |
| `body`            | `"Found N events. Tap to review."` (or zero-events variant) |
| `badge`           | `eventCount` — sets the app icon badge number               |
| `sound`           | `"default"`                                                 |
| `channelId`       | `"default"`                                                 |
| `data.type`       | `"parse_complete"`                                          |
| `data.jobId`      | the completed job ID                                        |
| `data.eventCount` | the final event count                                       |

**Key design decisions:**

- Push is sent **after** `parse_jobs.status = 'done'` is committed — a push
  failure never fails the job.
- `EXPO_ACCESS_TOKEN` is read from env; if absent the push is still attempted
  without an auth header (unauthenticated Expo push still works at low volume).
- `sendParseCompleteNotification` never throws — errors are logged as warnings.
- Dead token pruning is left to `notify-scheduler`; this function does not
  delete `DeviceNotRegistered` tokens to avoid cross-cutting concerns.

---

### Files modified

**`supabase/functions/parse-worker/index.ts`**

- Added `EXPO_PUSH_URL` constant (`https://exp.host/--/api/v2/push/send`)
- Added `sendParseCompleteNotification(userId, jobId, eventCount, admin)` function:
  - Fetches `expo_push_token` from `devices` where `user_id = userId`
  - Builds one payload per token, POSTs the array to Expo
  - Inspects per-ticket `status` fields in the Expo response; logs errors
  - Returns without throwing on any failure path
- Called from main handler after the final `parse_jobs` update

---

## Step 7 — Rate limiting ✅

### What was built

Automatic retry for transient pipeline failures, ensuring the per-user
15/day rate limit is not double-charged when the same job is retried.

**How retries work:**

The `parse_jobs` table now carries a `retry_count` column. When the worker
catches a retryable error code and `retry_count` is below `MAX_RETRIES (3)`:

1. Increment `retry_count` and reset `status = 'queued'` on the existing row.
2. Call `requeueToRedis` (RPUSH to the queue tail — retried jobs yield to new
   submissions from other users).
3. Return a non-error response so the cron tick is not counted as a crash.

If `requeueToRedis` fails (Redis is down), the function falls through and sets
`status = 'failed'` so the user is not left waiting indefinitely.

**Retryable vs permanent error codes:**

| Code                      | Retryable | Reason                                          |
| ------------------------- | --------- | ----------------------------------------------- |
| `STORAGE_DOWNLOAD_FAILED` | ✅        | Transient storage hiccup                        |
| `CLAUDE_API_ERROR`        | ✅        | Transient API rate-limit or timeout             |
| `TEXTRACT_ERROR`          | ✅        | Transient AWS API failure                       |
| `EXTRACTION_FAILED`       | ✅        | Transient Claude API failure (extraction stage) |
| `IMAGE_TOO_LARGE`         | ❌        | The image will always be too large              |
| `CONFIG_MISSING`          | ❌        | Deployment/config error — will not self-resolve |
| `USER_NOT_FOUND`          | ❌        | Logic error — will not self-resolve             |
| `OCR_FAILED`              | ❌        | Unknown error — retry risk too high             |

**Why the rate limit is correct:**
`isRateLimited` in `parse/index.ts` counts `parse_jobs` rows — one per user
submission, regardless of status. Worker retries operate on the **same row**
(updating `retry_count`), so they never inflate the count. Failed jobs hold
their slot; the limit is on submissions, not successes.

---

### Files created

**`supabase/migrations/20260910000002_parse_jobs_retry.sql`**

```sql
alter table public.parse_jobs add column retry_count integer not null default 0;
```

---

### Files modified

**`supabase/functions/parse-worker/index.ts`**

- Added `MAX_RETRIES = 3` constant
- Added `RETRYABLE_ERROR_CODES` set
- Added `requeueToRedis(jobId, userId, storagePath)` function — uses RPUSH,
  returns `boolean` (caller falls back to `failed` on `false`)
- Rewrote the catch block to attempt retry before marking the job failed

**`supabase/functions/parse/index.ts`**

- Added explanatory comment to `isRateLimited` clarifying why all statuses are
  counted and why worker retries do not inflate the count

**`supabase/functions/_shared/database.types.ts`**
Added `retry_count: number` to the `parse_jobs` Row type and
`retry_count?: number` to Insert and Update types.

---

## Step 8 — B2 variable-schedule detection ✅

### What was built

The final pipeline stage. After conflict detection, the worker checks whether
any candidate event's date falls on a valid weekly slot of one of the user's
variable-schedule routines. Matching events receive a
`variableScheduleSuggestions` array the review UI (Month 6) reads to offer a
"pre-fill this week" action.

**Key constraint: per-week confirmation only, never auto-commit.** The worker
attaches suggestions to `normalised_events`; no exception rows are written and
no calendar data changes until the user explicitly confirms in the review UI.

**`VariableScheduleSuggestion` shape:**

| Field            | Type     | Description                              |
| ---------------- | -------- | ---------------------------------------- |
| `masterId`       | `string` | The variable-schedule master event's ID  |
| `masterTitle`    | `string` | The routine's display name               |
| `occurrenceDate` | `string` | `YYYY-MM-DD` — the week slot to pre-fill |

When the user confirms a suggestion, the client calls
`PATCH .../occurrences/{occurrenceDate}` on `masterId` to write the exception
row with actual times.

**How detection works:**

1. If no candidate has a parseable date, return early (skip the DB fetch).
2. Fetch all variable-schedule masters for the user:
   `events` where `is_variable_schedule = true`, `is_master = true`,
   `owner_id = userId`. Selects `id, title, local_start` only.
3. For each dateable candidate, extract the `YYYY-MM-DD` date portion.
4. For each master, call `onVariableWeek(local_start, eventDate)`:
   - Parses the master's anchor date from `local_start`
   - Checks `(eventDateMs − anchorMs) % (7 × 86_400_000) === 0` and
     `eventDateMs >= anchorMs` — the same arithmetic as
     `_shared/variable.ts:isVariableWeek`, inlined to avoid importing the full
     `OccurrenceModel` machinery
5. Attach matching suggestions to the event; leave non-matching events unchanged.
6. On DB error: log a warning and return events without suggestions — graceful
   degradation, never a failed job.

---

### Files modified

**`supabase/functions/parse-worker/index.ts`**

- Added `VariableScheduleSuggestion` type
- Added `variableScheduleSuggestions: VariableScheduleSuggestion[]` field to
  `NormalizedEvent`; initialised to `[]` in `runNormalisation`
- Added `onVariableWeek(anchorLocalStart, date)` helper using already-imported
  `parseLocal`
- Added `runVariableScheduleDetection(events, userId, admin)` async function
- Wired B2 between Stage 4 (conflict detection) and the final `parse_jobs`
  write; `suggestionCount` included in the completion log and worker response

No new migrations — `variableScheduleSuggestions` is stored inside the
`normalised_events` JSONB column.

---

## Full pipeline — end-to-end flow

A single `parse-worker` invocation processes one job through all stages in
sequence:

```
parse:queue (Redis)
  │
  ▼ RPOP
Stage 1 — OCR
  Claude vision (primary) → confidence high?
  └─ no → Textract fallback
  writes: ocr_text, ocr_provider
  │
  ▼
Stage 2 — LLM extraction
  Claude Haiku (claude-haiku-4-5-20251001)
  writes: extracted_events
  │
  ▼
Stage 3 — Normalisation          [sync, no DB calls]
  chrono-node date resolution
  toRRule + parseRRule validation
  writes: normalised_events (intermediate)
  │
  ▼
Stage 4 — Conflict detection
  expandOccurrences (shared recurrence engine)
  UTC overlap check
  writes: CONFLICT flags into normalised_events
  │
  ▼
Stage 5 — B2 variable-schedule detection
  weekly-slot check per variable master
  writes: variableScheduleSuggestions into normalised_events
  writes: parse_jobs.status = 'done', event_count (final)
  │
  ▼
Stage 6 — Push notification      [best-effort]
  Expo push to all user devices
```

On any retryable error (Steps 1–3): `retry_count++`, `status = 'queued'`,
RPUSH back to Redis. Up to 3 retries before permanent `status = 'failed'`.

---

## Arlo's M5 tasks

**Upload UX**

- Camera roll picker, take-photo flow, web file upload
- Job-progress states (uploading → queued → processing → done/failed)
- Completion state: show event count, link to review sheet

**Privacy disclosure notice** _(Required for App Store submission)_ 🟡 In progress

- Persistent notice: images are sent to third-party AI and are not retained
  beyond the parse session
- Must be visible before the first upload and dismissible-but-re-viewable

Built so far (both apps), independent of the upload flow it will eventually gate:

- `src/lib/privacyDisclosure.ts` — `hasAcknowledgedDisclosure`/`acknowledgeDisclosure`, storage
  injected via a `DisclosureStore` interface (the same `Like`-interface pattern
  `loadOccurrences.ts` uses for `OccurrencesLike`) so the logic is testable without AsyncStorage or
  `localStorage`. Fails toward showing the notice again on any storage error.
- `src/lib/privacyDisclosureStore.ts` — the real store: `AsyncStorage` directly on mobile
  (structurally already a `DisclosureStore`); a `localStorage` wrapper on web, guarded for
  Next.js server rendering the same way `planpalClient.ts` guards `window`.
- `src/components/PrivacyDisclosure.tsx` — the notice itself (RN + DOM implementations), with a
  `mode: 'gate' | 'review'` prop: identical copy, only the action label and what dismissing means
  differ. `'gate'` blocks progress until acknowledged; `'review'` is for reopening it later without
  re-persisting.

**Remaining:** wiring — call the gate from the picker flow before the first upload (Upload UX
Task 3/8 in `docs/M5_UPLOAD_UX_PLAN.md`), and giving `'review'` mode a place to be reopened from
(a settings screen, which doesn't exist yet in either app). Nothing here blocks that wiring; it
was built ahead of the screen it attaches to, the same order Upload UX's Tasks 1–2 were.

---

## Cross-cutting tasks (starting M5)

See `docs/M5_CROSS_CUTTING_PLAN.md` for the full split of this section into code-native work vs.
manual/ops actions, and the implementation detail behind what's built.

**Cost monitoring & budget alerts**

- Claude API: set a daily spend alert in the Anthropic console — ⬜ manual action, not done
  (see `docs/SECRETS.md`'s `ANTHROPIC_API_KEY` row, which has carried this as an open rotation note
  since it was written)
- Monthly infra budget line: Supabase, Upstash, Textract — ⬜ manual action, not done
- Spend kill-switch: a threshold above which new parse jobs are rejected with a
  `503 SERVICE_UNAVAILABLE` until reset — ✅ **Complete.** `supabase/functions/_shared/spend.ts`
  prices every Claude OCR/extraction call from its token usage, records it to the new
  `parse_spend_ledger` table, and both `POST /parse/upload-url` and `POST /parse` reject new jobs
  with `503 SERVICE_UNAVAILABLE` once trailing-24h spend crosses `PARSE_DAILY_SPEND_LIMIT_USD` (env
  var, unset = disabled). Textract is not priced — no sourced current AWS rate to attach to it; see
  the plan doc.

**User support & feedback loop**

- In-app feedback channel — ✅ **Backend/client/form complete, not wired.** `POST /feedback`
  (new `feedback` table, owner-scoped RLS, rate-limited to 20/user/24h) + `FeedbackResource` in
  `packages/api-client` + a self-contained `FeedbackForm` component in both apps. Not yet reachable
  from either app — no Settings screen (or other entry point) exists to open it from; see
  `docs/M5_CROSS_CUTTING_PLAN.md` Task 2.
- Triage SLA for the closed beta period — ⬜ manual decision, not made; should land before the
  feedback channel is actually wired up and reachable (a channel nobody commits to reading on a
  cadence is worse than none)

---

## Known risks

- LLM parsing cost can scale unexpectedly — monitor Claude API daily spend from
  the first deploy. The 15/user/day rate limit caps per-user cost, not aggregate
  cost across all users.
- Any generated recurrence rule must be validated against the engine's supported
  RRULE subset on write; an unsupported rule will fail silently on read.
- `expandOccurrences` is called once per job with the user's full event set.
  At beta scale this is acceptable; at scale it becomes a query that grows with
  calendar size. Profile before M10.

---

## Deployment checklist

For any developer picking this up or deploying to a new environment:

**Step 1 — Upload flow**

```bash
npx supabase secrets set UPSTASH_REDIS_REST_URL=https://... UPSTASH_REDIS_REST_TOKEN=...
npx supabase functions deploy parse
npx supabase db push
```

**Step 2 — OCR worker**

```bash
npx supabase secrets set AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=us-east-1
npx supabase functions deploy parse-worker
npx supabase db push
```

Then in the Supabase SQL editor:

```sql
select vault.create_secret(
  'https://<ref>.supabase.co/functions/v1/parse-worker',
  'parse_worker_function_url'
);
```

**Steps 3–8 — Full pipeline (deploy after Steps 1–2)**

```bash
npx supabase db push
npx supabase functions deploy parse-worker
```

Steps 3–8 are all implemented inside `parse-worker/index.ts`. The three new
migrations (`parse_jobs_extraction`, `parse_jobs_normalised`,
`parse_jobs_retry`) are applied by `db push`. No additional secrets or vault
entries are required beyond those set in Steps 1–2.
