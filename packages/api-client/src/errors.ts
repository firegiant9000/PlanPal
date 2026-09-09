import type { ApiErrorCode } from '@planpal/types';

/**
 * AD-7: the client throws, it does not return result objects. Callers use
 * ordinary `try/catch` and error boundaries rather than branching on `.ok` at
 * every call site.
 *
 * `code` is the generated `ApiErrorCode` (AD-8), not `string`, so a `switch`
 * over it is exhaustively checked and cannot silently rot when the contract
 * gains a code.
 */
export class PlanPalApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'PlanPalApiError';
  }
}

/**
 * Not every failure comes back in our envelope, and that is the case the
 * contract does not describe.
 *
 * Kong answers an expired or malformed JWT before our handler runs:
 *
 *   curl -H "Authorization: Bearer not-a-jwt" .../functions/v1/events
 *   {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT format", ...}
 *   HTTP 401
 *
 * `openapi.yaml` says 401 -> the `Unauthenticated` envelope, and our
 * `unauthenticated()` only ever runs on requests the gateway let through. A
 * proxy 502 is an HTML page. So the status is the only thing that can be
 * trusted here, and the code is synthesised from it — the gateway's own code
 * string is not our contract and must not leak into `ApiErrorCode`.
 */
export function mapNonEnvelopeError(status: number, body: string): PlanPalApiError {
  return new PlanPalApiError(codeForStatus(status), describe(status, body), status);
}

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'VALIDATION_ERROR';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 405:
      return 'METHOD_NOT_ALLOWED';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}

/**
 * Keep a slice of the body in the message. An unrecognised failure with the
 * body discarded is the hardest kind to diagnose later, and this path exists
 * precisely for responses nothing else in the system explains. Truncated
 * because the body may be an entire HTML error page.
 */
function describe(status: number, body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return `Request failed with HTTP ${status} and an empty body.`;
  const excerpt = trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
  return `Request failed with HTTP ${status}: ${excerpt}`;
}
