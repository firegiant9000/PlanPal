# Upload UX — implementation plan (M5, Arlo's task)

> **Status 2026-09-29: DEFERRED** until P1 to P3 of [planning/DEVELOPMENT_PLAN.md](planning/DEVELOPMENT_PLAN.md) are done. The plan below is still valid when it resumes.

**Derived from:** [MONTH5.md](MONTH5.md), "Arlo's M5 tasks → Upload UX". That document names the
three features; this one turns them into files, code, and an order to build them in.
**Audience:** an engineer who has not seen the parse pipeline before. Every task names its files,
what it depends on, and what "done" looks like.
**Scope:** the _Upload UX_ line item only — camera roll / take-photo / web file upload, job-progress
states, and the completion state. The **Privacy disclosure notice** is a separate MONTH5.md line
item and is not covered here (it blocks the App Store submission, not this flow, though the
disclosure copy should render _before_ the first picker opens — see Task 6).

---

## What the backend already gives this feature

Three endpoints, all live (`supabase/functions/parse/index.ts`, `parse-worker/index.ts`), typed
end-to-end through `packages/api-contract/openapi.yaml` → `@planpal/types` → `ParseResource`
(`packages/api-client/src/resources/parse.ts`):

| Call                                           | Returns                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `planpalClient.parse.getUploadUrl()`           | `{ uploadUrl, storagePath, expiresAt }` — signed PUT URL, valid 60s                |
| `planpalClient.parse.enqueue({ storagePath })` | `ParseJob` — `{ jobId, status: 'queued', eventCount: null, errorCode: null, ... }` |
| `planpalClient.parse.getJob(jobId)`            | `ParseJob` — poll until `status` is `done` or `failed`                             |

`ParseJobStatus` is `queued \| processing \| done \| failed`. **Note:** the worker's retry logic
(Step 7) can move a job from `processing` back to `queued` on a transient failure before it
eventually reaches `done`/`failed` — the client must treat `queued`/`processing` as one
"in progress" bucket and not assume monotonic forward progress, or a retry will look like a hang.

**What `GET /parse/{jobId}` does _not_ give you:** the extracted events themselves. The worker
never writes to the `events` table and the contract only exposes `eventCount` (an integer) once
`status: 'done'`. There is no endpoint today that returns event titles/times for a job. That is
Month 6's "Review UI" work. **Decision (confirmed with the user):** the completion state's "Review"
action goes to a stub screen that shows the count and says full review is coming — it does not list
events, and this step adds no new backend endpoint. Month 6 replaces the stub's body only; it should
not need to change the navigation contract this step establishes (route name + `jobId` param).

**Push notification:** `parse-worker` (Step 6) sends an Expo push with
`data: { type: 'parse_complete', jobId, eventCount }` once a job reaches `done`. Nothing in the
client currently listens for a notification tap (`app/_layout.tsx` only registers the token). This
step is what wires that listener up, so a completed scan can be reached from a cold tap on the
notification, not just by having the app open.

---

## Scope split: mobile vs. web

Both apps need this, but the mechanics differ:

- **Mobile** (`apps/mobile`, Expo/React Native): camera roll picker, take-photo, background-safe
  upload, Expo push listener.
- **Web** (`apps/web`, Next.js): `<input type="file">` (with `capture` hint on mobile browsers,
  best-effort), no push listener — completion is discovered by polling only while the tab is open.

Everything under "Shared building blocks" is written once and used by both; everything under
"Mobile" / "Web" is per-app.

---

## Hard constraint: the api-client boundary (§15)

`packages/api-client/src/lint-rules.test.ts` enforces by lint that **no code in `apps/mobile` or
`apps/web` may call `fetch` or import `@supabase/supabase-js` directly.** The presigned upload PUT
is a raw binary `fetch` to a Supabase Storage host — a different host and auth scheme than
`Http`'s JSON envelope calls. It must live inside `packages/api-client`, not in a screen or hook.
This is why Task 1 adds an `upload` method to `ParseResource` rather than doing the PUT in the
screen component.

---

## Task 1 — `ParseResource.upload()` (shared, `packages/api-client`) ✅ Complete

**File:** `packages/api-client/src/resources/parse.ts`

Add a fourth method that performs the signed PUT and lives entirely inside the one package allowed
to touch `fetch` directly:

```ts
export interface ParseResource {
  getUploadUrl(): Promise<ParseUploadUrl>;
  enqueue(input: ParseJobCreate): Promise<ParseJob>;
  getJob(jobId: string): Promise<ParseJob>;

  /**
   * Step 1a continued — PUT the image binary to a signed Supabase Storage URL
   * obtained from `getUploadUrl()`. This does NOT go through `Http`: the
   * target is a different host with token-in-URL auth, not our gateway's JSON
   * envelope. It is the one exception to "all requests go through `send()`",
   * and it lives here (not in a screen) because §15 forbids `fetch` outside
   * this package.
   */
  upload(uploadUrl: string, file: Blob, contentType: string): Promise<void>;
}
```

Implementation notes:

- Plain `fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file })`.
- On a non-2xx response, throw `mapNonEnvelopeError(res.status, await res.text())` — **not** a new
  error code. `PlanPalApiError.code` is typed as `ApiErrorCode`, the closed union generated from
  `openapi.yaml`'s `ErrorCode` enum, so an invented code like `UPLOAD_FAILED` would not type-check.
  Supabase Storage's error body isn't our `{ ok, error }` envelope either, which is exactly the
  case `mapNonEnvelopeError` already exists for (it's the same helper `Http` uses for a gateway
  502/malformed-JWT body) — it synthesises a contract-legal code from the HTTP status (403→
  `FORBIDDEN`, 429→`RATE_LIMITED`, etc.) so callers still catch one `PlanPalApiError` shape
  everywhere.
- No retry inside `upload()` — the signed URL expires in 60s and a retry needs a _new_ URL, so
  retry is the caller's job (Task 3 covers requesting a fresh URL and retrying once).
- `Blob` is the right type for both platforms: React Native's `fetch` accepts a `Blob` from
  `expo-file-system`/`expo-image-picker`'s result, and the DOM `File` from an `<input>` already
  _is_ a `Blob`.

**Tests:** `packages/api-client/src/resources/parse.test.ts` (new) — mock `fetch`, assert method,
URL, header, and body pass-through; assert a 4xx/5xx throws `PlanPalApiError`.

---

## Task 2 — job-state machine (shared, framework-agnostic) ✅ Complete

Both apps need identical logic for "what does this job's status mean right now" — keep it a pure
function so it's unit-testable without a renderer, following the same pattern as
`apps/mobile/src/lib/occurrenceWindow.ts` and `loadOccurrences.ts`.

**New file (duplicated per app, same as `Button.tsx`/`Text.tsx` are per-app today — this package
has no shared non-UI logic layer between mobile and web):**

- `apps/mobile/src/lib/parseJob.ts`
- `apps/web/src/lib/parseJob.ts`

```ts
export type UploadStage =
  | { kind: 'picking' }
  | { kind: 'uploading' }
  | { kind: 'polling'; jobId: string; status: 'queued' | 'processing' }
  | { kind: 'done'; jobId: string; eventCount: number }
  | {
      kind: 'failed';
      reason: 'upload' | 'server' | 'permission' | 'rate_limited' | 'timeout';
      message: string; // machine-readable diagnostic, not display copy — see below
    };

export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 90_000; // give up and show a "still working" failure state past this
```

Two changes from the original sketch, made while implementing:

- **`reason` gained a fifth value, `'timeout'`**, distinct from `'server'`. A job whose own status
  is `failed` and a job that simply hasn't finished in 90s are different situations — Task 3's
  copy map can now tell a user "still working, check back" instead of implying the scan failed.
- **`message` is documented as a diagnostic, not display text.** It's a `PlanPalApiError.code`, the
  job's own `errorCode`, or a code coined here (`POLL_TIMEOUT`) — for logs/analytics. The screen
  renders copy from `reason` alone, so adding a `reason` never requires inventing user-facing prose
  in this file.

Went with a **pure async generator**, not a callback — `pollJob(getJob, jobId, options)` returns
`AsyncGenerator<UploadStage, UploadStage, void>`. A caller does:

```ts
for await (const stage of pollJob(planpalClient.parse.getJob, jobId, {})) {
  setUploadStage(stage); // one of the 'polling' stages
}
// loop exits once the generator *returns* (done/failed) — that value isn't
// visible via for-await; call `.next()` manually if you need the terminal
// value directly instead of just observing it via loop-exit + a ref.
```

Breaking out of the loop early (e.g. on unmount) is a plain `break` — the generator protocol turns
that into an implicit `.return()` on the iterator, so there's no `AbortSignal` or manually-tracked
`setInterval` handle to clean up. `getJob` is typed against a narrow structural `ParseJobPoll`
interface (`{ status, eventCount, errorCode }`), the same "`Like`" pattern `loadOccurrences.ts`
uses for `OccurrencesLike` — the module stays free of `@planpal/api-client` and is testable without
it.

Behavior implemented:

- Calls `getJob(jobId)` immediately (no delay before the first check), then waits `intervalMs`
  between subsequent calls.
- Yields `{ kind: 'polling', jobId, status }` on `queued`/`processing`.
- Returns `{ kind: 'done', jobId, eventCount }` on `status: 'done'` — `eventCount ?? 0`, since the
  contract marks it nullable even though it's guaranteed non-null once `done`; the fallback is
  belt-and-suspenders, not an expected path.
- Returns `{ kind: 'failed', reason: 'server', message: errorCode ?? 'PARSE_FAILED' }` on
  `status: 'failed'`.
- Returns `{ kind: 'failed', reason: 'timeout', message: 'POLL_TIMEOUT' }` once `Date.now()` passes
  the deadline — checked _before_ yielding, so the loop never yields a stage it's about to
  contradict.

**Tests:** `parseJob.test.ts` (one per app, `jest`/`vitest` fake timers respectively) — a `getJob`
stub scripted `processing → queued → done`, matching what a Step-7 retry actually produces;
`eventCount: 0` treated as real, not falsy; both failure branches; the deadline-passed case (using
`timeoutMs: 0` for a deterministic check with no timer advancement needed); and that breaking a
`for await` loop stops further polling.

---

## Task 3 — the upload flow, mobile

**New dependency:** `expo-image-picker` (add to `apps/mobile/package.json`). Handles both the
camera-roll picker and the take-photo flow through one API (`launchImageLibraryAsync` /
`launchCameraAsync`), and its permission prompts are already App-Store-review-safe boilerplate —
no need to hand-roll `expo-camera`.

**New file:** `apps/mobile/app/scan.tsx` — a screen, reachable from a new FAB/menu entry on
`app/index.tsx` (see Task 5), that owns the whole flow as one `UploadStage` state machine
(Task 2's type):

1. **`picking`** — action sheet: "Take Photo" / "Choose from Library" (use `Alert.alert` with
   options, matching the existing action-sheet pattern in `app/index.tsx`'s `handleEventPress`,
   or a small custom sheet if `Alert` can't carry three real buttons cleanly on both platforms —
   decide when building, not in this doc).
   - `ImagePicker.requestCameraPermissionsAsync()` / `requestMediaLibraryPermissionsAsync()`
     before each respective path. A denial goes straight to `{ kind: 'failed', reason: 'permission' }`
     with copy that names Settings, not a generic error.
2. **`uploading`** — once a `uri` comes back from the picker:
   - `planpalClient.parse.getUploadUrl()`
   - `fetch`-free: turn the picker's `uri` into a `Blob` via `fetch(uri).then(r => r.blob())` —
     this is the one legal RN idiom for reading a local file into a `Blob` and is _not_ a network
     call (`file://` URIs never leave the device), so it does not trip the §15 rule, but confirm
     this reasoning against the lint rule's actual glob before relying on it — if the lint rule
     matches the bare identifier `fetch` regardless of the URL scheme, this line has to move inside
     `packages/api-client` too (e.g. `ParseResource.readLocalFile(uri)`), which is a one-method
     addition to Task 1 if so.
   - `planpalClient.parse.upload(uploadUrl, blob, mimeTypeFromPicker)`
   - On failure: **one retry** with a fresh `getUploadUrl()` (the 60s window may have lapsed while
     the user was picking/confirming), then `{ kind: 'failed', reason: 'upload' }`.
   - On a `RATE_LIMITED` `PlanPalApiError` from `getUploadUrl()` (429): go straight to
     `{ kind: 'failed', reason: 'rate_limited' }` with the "15 screenshots per 24 hours" copy —
     don't attempt the upload at all.
3. **`polling`** — `planpalClient.parse.enqueue({ storagePath })`, then hand the returned `jobId`
   to Task 2's poller. Screen shows the current sub-state (`queued` → "In queue…",
   `processing` → "Reading your screenshot…").
   - **Backgrounding:** if the user leaves the screen mid-poll, stop polling (clear the interval on
     unmount) but do _not_ cancel the job server-side — it keeps running. Re-entering `scan.tsx`
     with a `jobId` still in flight (see persistence note below) should resume polling, not restart
     the whole flow.
   - **Persistence across app kill:** write `{ jobId, storagePath }` to `AsyncStorage` (already a
     dependency) the moment `enqueue()` succeeds, clear it on reaching `done`/`failed`. On mount,
     `scan.tsx` checks for a stored in-flight job before showing the picker — this is what makes
     the push notification (Task 4) land on a screen that already knows what job it's about,
     instead of a cold "pick a photo" screen.
4. **`done`** — completion state (Task 6, shared component).
5. **`failed`** — reuse the `CalendarState`-style pattern (`apps/mobile/src/lib/emptyStates.tsx`)
   but scoped to this screen: a title/body/retry map keyed by `UploadStage['reason']`, not a new
   ad hoc set of `Alert.alert` calls. This keeps the four failure copies in one reviewable place.

**Analytics** (mirror `create-event.tsx`'s `getAnalytics().track(...)` convention): fire
`scan_started` (with `source: 'camera' | 'library'`), `scan_uploaded`, `scan_completed` (with
`event_count`), `scan_failed` (with `reason`). This is what will eventually answer "where do people
drop off" without reading logs.

---

## Task 4 — push notification → deep link, mobile

**File:** `apps/mobile/app/_layout.tsx` (modify)

Add an `expo-notifications` response listener alongside the existing token-registration effect:

```ts
useEffect(() => {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | { type?: string; jobId?: string }
      | undefined;
    if (data?.type === 'parse_complete' && data.jobId) {
      router.push({ pathname: '/scan', params: { jobId: data.jobId } });
    }
  });
  return () => sub.remove();
}, [router]);
```

`scan.tsx` needs to accept an optional `jobId` route param: if present on mount, skip straight to
`polling` (well, straight to `getJob(jobId)` — it's likely already `done`) instead of opening the
picker. This is the same "resume an in-flight job" code path Task 3's `AsyncStorage` check uses —
build it once, feed it from either source (stored job on cold start, or route param from a tap).

**Not doing:** foreground notification banners/badges beyond what `expo-notifications`'s default
handler already does. `registerPushToken.ts` and `notify-scheduler` already establish the
notification-handler config (if any); this task only adds the _response_ listener, not a new
presentation handler, unless the existing config suppresses foreground alerts entirely — check
`app.json`'s `notification` block and `expo-notifications` setup calls before assuming a listener
alone is sufficient.

---

## Task 5 — entry point, mobile

**File:** `apps/mobile/app/index.tsx` (modify)

The single FAB currently opens `/create-event` only. Two options, pick one when building:

- Long-press the FAB for a small menu ("New event" / "Scan a schedule"), or
- A second, smaller FAB above it (matches the existing `bottom: 140` stacking already reserved
  above the bottom sheet).

Either way: `router.push('/scan')`. This doc doesn't prescribe the exact affordance — it's a
one-line navigation change once the menu/second-FAB decision is made, and is worth a quick look at
`@planpal/design-tokens` / any existing multi-action-FAB precedent before inventing one.

---

## Task 6 — completion state (shared component, per-app implementation)

Per the confirmed scope decision: no new backend endpoint, no real event list. The completion state
and the stub review screen are two small pieces:

**In `scan.tsx` (mobile) / the upload page (web), `kind: 'done'` renders:**

- "Found N events" / "No events found" (mirror the exact copy `parse-worker`'s push body already
  uses — `sendParseCompleteNotification`'s `noun`/`body` logic — so push and in-app copy agree).
- A primary button: "Review" → `router.push({ pathname: '/review/[jobId]', params: { jobId } })`.
- A secondary action: "Scan another" → reset to `picking`.

**New stub screen:**

- `apps/mobile/app/review/[jobId].tsx`
- `apps/web/src/app/review/[jobId]/page.tsx`

Both do the same thing: `getJob(jobId)` once for `eventCount`, render "N events found in this scan
— full review is coming soon" plus a "Back to calendar" action. No polling (the job is already
`done` by construction), no event list, no `PATCH` calls. Keep it genuinely small — the entire
point of stubbing it is that Month 6 replaces the _body_ of this screen without anyone needing to
touch the route name, the param, or anything that links to it.

---

## Task 7 — the upload flow, web

**File:** `apps/web/src/app/scan/page.tsx` (new), mirroring `apps/mobile/app/scan.tsx`'s state
machine (Task 2's `UploadStage`, Task 3's stage transitions) but with DOM primitives:

- Picker: `<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" />`.
  `capture` is a hint mobile browsers may honor for a direct camera flow; desktop browsers ignore it
  and just show a file dialog — this single input covers "camera roll picker, take-photo flow, web
  file upload" from the plan doc without three separate code paths, unlike mobile where camera vs.
  library are genuinely different native APIs.
- The selected `File` (a `Blob` already) goes straight into `ParseResource.upload()` — no `fetch`-a-
  `uri`-into-a-`Blob` step needed, unlike mobile.
- No `AsyncStorage`/persistence-across-restart concern (a page reload is a much rarer interruption
  than an OS backgrounding a mobile app, and there's no push-driven resume path on web) — poll only
  while the page is mounted; losing the tab loses the polling, which is an acceptable and explicitly
  scoped gap for this pass (state it in the PR description so it isn't mistaken for an oversight).
- Reuse the `Button`/`Text` components already in `apps/web/src/components/`.

**Entry point:** wherever `apps/web/src/app/calendar/page.tsx` puts its "create event" affordance —
add "Scan a schedule" next to it, same reasoning as Task 5.

---

## Task 8 — the privacy disclosure gate (interaction only — copy/legal is the other MONTH5.md line item)

This step doesn't write the disclosure copy, but the picker flow (Task 3 step 1 / Task 7) must not
be reachable before the disclosure has been shown at least once. Concretely: `scan.tsx`'s
`picking` stage checks a persisted "disclosure acknowledged" flag (`AsyncStorage` on mobile,
`localStorage` on web) before opening the native picker, and shows the disclosure component first
if unset. Building the actual notice component/copy is out of scope here — this task is just the
one `if (!acknowledged) return <Disclosure onAccept={...} />` gate so the two tasks compose cleanly
instead of Arlo having to retrofit it into a finished picker flow later.

---

## Build order

1. Task 1 (`ParseResource.upload`) — everything else depends on it.
2. Task 2 (state machine) — pure logic, no UI, fast to get right and test in isolation.
3. Task 3 + Task 5 (mobile flow + entry point) — the primary platform.
4. Task 6 (completion + stub review) — needed to close the loop on Task 3.
5. Task 4 (push deep link) — layers on top of a working Task 3.
6. Task 7 (web flow) — same shape as Task 3, faster once the mobile version has shaken out the
   state-machine edge cases.
7. Task 8 (disclosure gate) — trivial once Tasks 3/7 exist; coordinate the actual copy with
   whoever owns the Privacy disclosure notice line item.

## Explicitly out of scope for this plan

- Writing the disclosure notice's copy/legal content (separate MONTH5.md line item).
- A real review-and-confirm UI reading `variableScheduleSuggestions` / `conflictingEventIds` and
  calling `PATCH .../occurrences/{date}` — that's Month 6, and depends on a backend endpoint that
  doesn't exist yet (exposing `normalised_events` per job).
- Any new backend/contract changes. Every task above consumes the existing `parse` /
  `parse-worker` contract as-is.
- Cost/budget alerting and the in-app feedback channel (separate "cross-cutting" MONTH5.md tasks).
