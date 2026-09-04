/**
 * Field validators shared by the Edge Functions.
 *
 * These were duplicated: `events/index.ts` and `me/index.ts` each declared
 * their own `VISIBILITIES` array and their own IANA-zone check (one as a
 * helper, one inline with different wording). The contract defines each of
 * these exactly once, so validating them twice is a drift vector — adding a
 * visibility value is a one-line spec change that would otherwise have to find
 * two hand-maintained copies, and missing one makes `PATCH /me` accept a
 * `defaultVisibility` that `POST /events` rejects.
 */

/** `Visibility` in openapi.yaml. */
export const VISIBILITIES = ['private', 'shared_all', 'shared_select', 'sensitive_public'];

/** `IsoDate` — shape only. Use {@link isCalendarDate} for a real date. */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `LocalDateTime` — a naive wall-clock stamp, seconds optional. */
export const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/**
 * Is this a date that exists?
 *
 * `DATE_RE` alone accepts `2026-02-31` and `2026-13-01`. Postgres then raises
 * SQLSTATE 22008, which is not in the `dbError` map, so a plain typo surfaced
 * as a 500 INTERNAL_ERROR. Round-tripping through `Date.UTC` catches it: the
 * constructor normalises an out-of-range day into the next month, so a date
 * that does not survive the round trip did not exist.
 */
export function isCalendarDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [year, month, day] = value.split('-').map(Number);
  const ms = Date.UTC(year!, month! - 1, day!);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
}

/**
 * IANA zone check — `Intl` is the authority the recurrence engine already
 * uses, so accepting anything it rejects would store a zone the engine cannot
 * expand. Returns an error message, or null when valid.
 */
export function validateTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return '"timezoneId" is required.';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    return `"timezoneId" is not a recognised IANA timezone: ${value}`;
  }
  return null;
}
