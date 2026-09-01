// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Source: packages/recurrence/src/index.ts
// Regenerate: pnpm recurrence:sync   (CI verifies with --check)
// ---------------------------------------------------------------------------

/**
 * @planpal/recurrence — server-side recurrence engine (Phase 4 kickoff).
 *
 * Expands master-rule + exception events into concrete occurrences over a date
 * range. The client NEVER expands rules; this runs server-side only. See README.md
 * for the supported RRULE subset and the Month-2 completion scope.
 */
export { expandOccurrences } from './expand.ts';
export { parseRRule, occurrenceDates, type ParsedRule } from './rrule.ts';
export { localToUtc, parseLocal, formatLocal, type Civil } from './timezone.ts';
export { mapEventRow, type EventRow } from './row.ts';
export {
  type EventRecord,
  type DateRange,
  MAX_RANGE_DAYS,
  RecurrenceRangeError,
  UnsupportedRRuleError,
} from './types.ts';
