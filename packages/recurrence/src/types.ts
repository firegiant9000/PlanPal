/**
 * Engine input/contract types and typed errors.
 *
 * The engine is PURE: it never touches the database. Callers (the future
 * `GET /occurrences` endpoint, M2) fetch the owner's rows from Supabase, map them
 * with `mapEventRow`, and hand the resulting `EventRecord[]` to `expandOccurrences`.
 */
import type { Visibility } from '@planpal/types';

/** Hard cap on the expansion window, mirrored from the OpenAPI `RangeTo` bound. */
export const MAX_RANGE_DAYS = 180;

/**
 * One `events` row, normalized to camelCase. Mirrors the columns in
 * `supabase/migrations/...core_schema.sql`. A record is one of two shapes:
 *   - MASTER / STANDALONE: `isMaster = true`, no `masterEventId`. Carries the full
 *     definition; `recurrenceRule` is null for a standalone event.
 *   - EXCEPTION: `isMaster = false`, `masterEventId` + `recurrenceExceptionDate` set.
 *     A sparse override (null inheritable fields = inherit from the master); a
 *     cancelled occurrence is an exception with `isCancelled = true`.
 */
export interface EventRecord {
  id: string;
  ownerId: string;
  title: string | null;
  description: string | null;
  location: string | null;
  /** Naive wall-clock "YYYY-MM-DDTHH:mm[:ss]"; interpreted in `timezoneId`. */
  localStart: string | null;
  localEnd: string | null;
  timezoneId: string | null;
  isMaster: boolean;
  masterEventId: string | null;
  /** The overridden occurrence's calendar date ("YYYY-MM-DD"); exceptions only. */
  recurrenceExceptionDate: string | null;
  recurrenceRule: string | null;
  isCancelled: boolean;
  isVariableSchedule: boolean;
  visibility: Visibility | null;
  colorLabel: string | null;
}

/** Inclusive expansion window. Both ends are calendar dates ("YYYY-MM-DD"). */
export interface DateRange {
  from: string;
  to: string;
}

/** Thrown when the requested range is malformed or exceeds {@link MAX_RANGE_DAYS}. */
export class RecurrenceRangeError extends Error {
  override readonly name = 'RecurrenceRangeError';
}

/** Thrown when an RRULE uses a feature outside the Phase 4 kickoff subset. */
export class UnsupportedRRuleError extends Error {
  override readonly name = 'UnsupportedRRuleError';
}
