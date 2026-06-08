/**
 * API envelope + error contract. This is the shape every endpoint returns; the
 * concrete request/response payloads are filled in by the Phase 1 OpenAPI spec.
 */

export interface ApiError {
  /** Stable, machine-readable code. Enumerated authoritatively in the OpenAPI spec. */
  code: string;
  /** Human-readable message for developers/logs (not necessarily user-facing). */
  message: string;
  /** Optional field-level validation details. */
  details?: Record<string, string[]>;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** Cursor-based pagination wrapper for list endpoints. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}
