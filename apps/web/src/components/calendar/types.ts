/**
 * The occurrence shape the web calendar views render.
 *
 * Structurally the contract's `EventOccurrence` with `colorLabel` narrowed to a
 * required nullable, so views never have to distinguish "absent" from "null".
 * Declared here rather than imported from the generated types so the views stay
 * renderable from a plain object in a test.
 */
export interface WebOccurrence {
  eventId: string;
  occurrenceDate: string;
  title: string;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  visibility: string;
  colorLabel: string | null;
  isException: boolean;
  isVariableSchedule: boolean;
}
