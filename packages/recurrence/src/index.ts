/**
 * @planpal/recurrence — server-side recurrence engine (Phase 4 kickoff).
 *
 * Expands master-rule + exception events into concrete occurrences over a date
 * range. The client NEVER expands rules; this runs server-side only. See README.md
 * for the supported RRULE subset and the Month-2 completion scope.
 */
export { expandOccurrences } from './expand.js';
export { parseRRule, occurrenceDates, type ParsedRule } from './rrule.js';
export {
  buildRRule,
  type RRuleSelection,
  type RepeatSelection,
  type EndRepeatSelection,
} from './rrule.js';
export { localToUtc, parseLocal, formatLocal, type Civil } from './timezone.js';
export { mapEventRow, type EventRow } from './row.js';
export {
  type EventRecord,
  type DateRange,
  MAX_RANGE_DAYS,
  RecurrenceRangeError,
  UnsupportedRRuleError,
} from './types.js';
