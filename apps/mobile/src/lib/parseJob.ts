/**
 * Client-side state machine for a single screenshot-parse job (M5 Upload UX,
 * Task 2 of docs/M5_UPLOAD_UX_PLAN.md).
 *
 * Framework-agnostic on purpose — duplicated between apps/mobile and
 * apps/web rather than shared, the same call already made for
 * Button.tsx/Text.tsx: there is no shared non-UI logic layer between the two
 * apps, and this is small enough that introducing one just for this file
 * isn't worth it.
 */

export type UploadStage =
  | { kind: 'picking' }
  | { kind: 'uploading' }
  | { kind: 'polling'; jobId: string; status: 'queued' | 'processing' }
  | { kind: 'done'; jobId: string; eventCount: number }
  | {
      kind: 'failed';
      reason: 'upload' | 'server' | 'permission' | 'rate_limited' | 'timeout';
      /**
       * A machine-readable diagnostic (a `PlanPalApiError.code`, the job's own
       * `errorCode`, or a code coined here like `POLL_TIMEOUT`) — for logs and
       * analytics, not display. The screen renders copy from `reason` alone
       * (Task 3's title/body/retry map), so a new `reason` never needs a new
       * string here to stay meaningful to a user.
       */
      message: string;
    };

export const POLL_INTERVAL_MS = 2000;

/**
 * parse-worker's Step 7 retry logic can bounce a job from `processing` back to
 * `queued` up to 3 times before giving up permanently, so a slow job is not
 * necessarily a stuck one. 90s is generous enough to ride out a retry or two
 * without leaving a user staring at a spinner indefinitely when something is
 * genuinely wrong.
 */
export const POLL_TIMEOUT_MS = 90_000;

/** The slice of `ParseJob` this needs — injected so it is testable without the client package. */
export interface ParseJobPoll {
  status: 'queued' | 'processing' | 'done' | 'failed';
  eventCount: number | null;
  errorCode: string | null;
}

export type GetParseJob = (jobId: string) => Promise<ParseJobPoll>;

export interface PollJobOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `GET /parse/{jobId}` until it reaches a terminal state.
 *
 * An async generator rather than a callback: the caller drives it with
 * `for await...of` and stops early with a plain `break`, which the generator
 * protocol turns into a `return()` call on the iterator — cleanup without an
 * `AbortSignal` or a manually-tracked interval handle. Each loop iteration
 * yields the in-progress stage; the terminal `done`/`failed` stage comes back
 * as the loop's completion value (a `return`, not a `yield`).
 *
 * Resolves to a `failed` stage rather than throwing for both "the job's own
 * status is failed" and "it did not finish inside the timeout" — `getJob`
 * itself can still throw, which is the genuine exceptional case (a network or
 * auth error) callers should catch separately; these two are normal outcomes
 * of polling.
 */
export async function* pollJob(
  getJob: GetParseJob,
  jobId: string,
  options: PollJobOptions = {},
): AsyncGenerator<UploadStage, UploadStage, void> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const job = await getJob(jobId);

    if (job.status === 'done') {
      return { kind: 'done', jobId, eventCount: job.eventCount ?? 0 };
    }
    if (job.status === 'failed') {
      return { kind: 'failed', reason: 'server', message: job.errorCode ?? 'PARSE_FAILED' };
    }

    // `status` is `queued` or `processing` here. A Step-7 retry can move a job
    // from `processing` back to `queued`, so neither value alone is progress —
    // only the deadline below decides when to give up.
    if (Date.now() >= deadline) {
      return { kind: 'failed', reason: 'timeout', message: 'POLL_TIMEOUT' };
    }

    yield { kind: 'polling', jobId, status: job.status };
    await sleep(intervalMs);
  }
}
