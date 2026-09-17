import type { ParseJob, ParseJobCreate, ParseUploadUrl } from '@planpal/types';
import { mapNonEnvelopeError } from '../errors';
import type { Http } from '../http';

export interface ParseResource {
  /**
   * Step 1a — get a presigned URL for uploading a schedule screenshot directly
   * to Supabase Storage. Valid for 60 seconds. Pass the returned `storagePath`
   * to `enqueue` once the upload succeeds.
   */
  getUploadUrl(): Promise<ParseUploadUrl>;

  /**
   * Step 1a continued — PUT the image binary to the signed URL from
   * `getUploadUrl`. This is the one call in `ParseResource` that does not go
   * through `Http`: the target is Supabase Storage, not our gateway, so there
   * is no `apikey`/bearer header and no `{ ok, data }` envelope to unwrap — a
   * plain PUT is what a signed upload URL expects. It lives here rather than
   * in a screen because §15 forbids `fetch` anywhere outside this package.
   *
   * Throws `PlanPalApiError` on a non-2xx response. The signed URL is valid
   * for 60 seconds only; a failure here does not retry — callers that want a
   * retry should request a fresh URL from `getUploadUrl` first, since retrying
   * against an expired URL would just fail again.
   */
  upload(uploadUrl: string, file: Blob, contentType: string): Promise<void>;

  /**
   * Step 1b — enqueue a parse job for an already-uploaded screenshot.
   * `storagePath` must come from `getUploadUrl`. Returns immediately with the
   * job record; poll `getJob` for completion.
   */
  enqueue(input: ParseJobCreate): Promise<ParseJob>;

  /** Poll parse job status until `status` is `done` or `failed`. */
  getJob(jobId: string): Promise<ParseJob>;
}

export function createParseResource(http: Http): ParseResource {
  return {
    getUploadUrl() {
      return http.json<ParseUploadUrl>('parse/upload-url', { method: 'POST' });
    },

    async upload(uploadUrl, file, contentType) {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: file,
      });
      if (res.ok) return;
      // Not our envelope — Supabase Storage's own error body — so this is
      // exactly the case `mapNonEnvelopeError` exists for: synthesise a
      // contract `ApiErrorCode` from the status rather than inventing one.
      throw mapNonEnvelopeError(res.status, await res.text());
    },

    enqueue(input) {
      return http.json<ParseJob>('parse', { method: 'POST', body: input });
    },

    getJob(jobId) {
      return http.json<ParseJob>(`parse/${encodeURIComponent(jobId)}`);
    },
  };
}
