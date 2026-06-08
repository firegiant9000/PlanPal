/** ISO-8601 timestamp string in UTC, e.g. "2026-06-07T13:45:00Z". */
export type IsoDateTime = string & { readonly __brand: 'IsoDateTime' };

/** ISO-8601 calendar date with no time component, e.g. "2026-06-07". */
export type IsoDate = string & { readonly __brand: 'IsoDate' };

/** Local wall-clock time, "HH:mm" or "HH:mm:ss" (no offset). */
export type LocalTime = string & { readonly __brand: 'LocalTime' };

/** IANA timezone identifier, e.g. "America/New_York". */
export type TimezoneId = string & { readonly __brand: 'TimezoneId' };

/** RFC 5545 RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR". */
export type RRuleString = string & { readonly __brand: 'RRuleString' };
