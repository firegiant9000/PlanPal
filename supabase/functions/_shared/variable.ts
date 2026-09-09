/**
 * Variable-schedule masters — the weeks they occupy, and their placeholders.
 *
 * A variable master carries no RRULE: its `local_start` is a placeholder whose
 * time-of-day is meaningless and whose weekday is the anchor. The recurrence
 * engine deliberately does not expand it (there is no rule to expand), so the
 * "one occurrence per week, on the anchor weekday" rule lives here instead —
 * and it lives here rather than inside `occurrences/index.ts` because two
 * routes now need the same answer:
 *
 *   GET /occurrences         which weeks to synthesise placeholders for
 *   PATCH …/occurrences/{d}  whether {d} is a week this routine actually has,
 *                            and what to return when the override sets no times
 *
 * Answering that question twice is how the endpoint and the engine came to
 * disagree about which dates each owned in the first place.
 */
import { localToUtc, parseLocal } from './recurrence/index.ts';
import type { Database } from './database.types.ts';

const DAY_MS = 86_400_000;

/**
 * The subset of an events row this module reads, picked from the generated
 * row type rather than restated (T32/AD-11). A renamed column fails to
 * compile at the `Pick` instead of arriving as `undefined` at runtime.
 */
export type VariableMasterRow = Pick<
  Database['public']['Tables']['events']['Row'],
  | 'id'
  | 'title'
  | 'description'
  | 'location'
  | 'local_start'
  | 'local_end'
  | 'timezone_id'
  | 'visibility'
  | 'color_label'
>;

/** The descriptive fields an exception may override without setting times. */
export type VariableExceptionRow = Pick<
  Database['public']['Tables']['events']['Row'],
  'title' | 'description' | 'location' | 'visibility' | 'color_label'
>;

/** The `EventOccurrence` wire shape. */
export interface OccurrenceModel {
  eventId: string;
  occurrenceDate: string;
  title: string;
  description?: string | null;
  location?: string | null;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  utcStart: string;
  utcEnd: string;
  visibility: string;
  colorLabel?: string | null;
  isException: boolean;
  isVariableSchedule: boolean;
}

const civilMidnightMs = (localDateTime: string): number => {
  const c = parseLocal(localDateTime);
  return Date.UTC(c.year, c.month - 1, c.day);
};

const dateMidnightMs = (date: string): number => Date.parse(`${date}T00:00:00Z`);

/**
 * Does this variable master have a week on `date`?
 *
 * Weekly on the anchor weekday, on or after the anchor date. A date that fails
 * this has no placeholder and never will, so an exception row written against
 * it would be an orphan nothing reads.
 */
export function isVariableWeek(master: VariableMasterRow, date: string): boolean {
  if (!master.local_start) return false;
  const anchorMs = civilMidnightMs(master.local_start);
  const dateMs = dateMidnightMs(date);
  if (Number.isNaN(dateMs) || dateMs < anchorMs) return false;
  return (dateMs - anchorMs) % (7 * DAY_MS) === 0;
}

/** Every week of this master falling inside the inclusive window. */
export function variableWeeksInRange(
  master: VariableMasterRow,
  fromMs: number,
  toMs: number,
): string[] {
  if (!master.local_start) return [];
  const anchorMs = civilMidnightMs(master.local_start);
  const anchorDow = new Date(anchorMs).getUTCDay();
  const fromDow = new Date(fromMs).getUTCDay();

  const out: string[] = [];
  let cursor = fromMs + ((anchorDow - fromDow + 7) % 7) * DAY_MS;
  for (; cursor <= toMs; cursor += 7 * DAY_MS) {
    if (cursor < anchorMs) continue; // the routine had not started yet
    out.push(new Date(cursor).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * The placeholder occurrence for one week.
 *
 * `isVariableSchedule` stays true and the times carry no meaning — the client
 * renders "schedule not yet entered". An exception that set only descriptive
 * fields is layered on, so renaming a week does not make it disappear.
 */
export function variablePlaceholder(
  master: VariableMasterRow,
  date: string,
  exception: VariableExceptionRow | null,
): OccurrenceModel {
  const timeOfDay = master.local_start!.slice(11, 19) || '00:00:00';
  const endTimeOfDay = (master.local_end ?? master.local_start!).slice(11, 19) || '00:00:00';
  const localStart = `${date}T${timeOfDay}`;
  const localEnd = `${date}T${endTimeOfDay}`;
  const tz = master.timezone_id!;

  return {
    eventId: master.id,
    occurrenceDate: date,
    title: exception?.title ?? master.title ?? 'Variable schedule',
    description: exception?.description ?? master.description,
    location: exception?.location ?? master.location,
    localStart,
    localEnd,
    timezoneId: tz,
    utcStart: localToUtc(parseLocal(localStart), tz),
    utcEnd: localToUtc(parseLocal(localEnd), tz),
    visibility: exception?.visibility ?? master.visibility ?? 'private',
    colorLabel: exception?.color_label ?? master.color_label,
    isException: exception !== null,
    isVariableSchedule: true,
  };
}
