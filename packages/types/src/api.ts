/**
 * API envelope + error contract. This is the shape every endpoint returns; the
 * concrete request/response payloads are filled in by the Phase 1 OpenAPI spec.
 */

import type { ApiErrorCode } from './contract';

export interface ApiError {
  /**
   * Stable, machine-readable code, enumerated authoritatively in the OpenAPI
   * spec and generated from it (AD-8). Narrower than `string` on purpose: the
   * whole point is that a client can `switch` on this exhaustively.
   */
  code: ApiErrorCode;
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
