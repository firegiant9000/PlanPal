import { buildMonthGrid, resolveEventColor } from '@planpal/calendar-core';
import { theme } from '@planpal/ui';

/**
 * The calendar's view-state maths, extracted from `index.tsx` and `EventBar`.
 *
 * Deliberately free of any React Native import so it can be tested with plain
 * Vitest before `jest-expo` (H2) exists. Nothing here renders; it decides what
 * to fetch and what colour to draw.
 */

export interface OccurrenceItem {
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

export interface OccurrenceWindow {
  /** yyyy-mm-dd, inclusive. */
  from: string;
  /** yyyy-mm-dd, inclusive. */
  to: string;
}

/**
 * The date range the month view actually shows.
 *
 * Derived from `buildMonthGrid` rather than from the first and last of the
 * month, because the grid is always 6x7 and therefore spills into the
 * neighbouring months. Deriving it from the same function that renders the
 * cells is what stops the fetched range and the drawn range drifting apart.
 *
 * The client normalises reads to whole calendar months anyway, so asking for
 * the 42-day span costs no extra requests and cannot trip the endpoint's
 * `MAX_RANGE_DAYS = 180` cap.
 */
export function occurrenceWindow(year: number, month: number): OccurrenceWindow {
  const grid = buildMonthGrid(year, month);
  const firstWeek = grid[0]!;
  const lastWeek = grid[grid.length - 1]!;
  return {
    from: firstWeek[0]!.date,
    to: lastWeek[lastWeek.length - 1]!.date,
  };
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Shift a `yyyy-mm-ddThh:mm:ss` local time by whole hours.
 *
 * The arithmetic runs in UTC on purpose, and that is not a bug being papered
 * over: these strings are wall-clock times carrying a separate `timezoneId`,
 * and the server derives the real instant (AD-4). Doing the maths in the
 * device's local zone would apply a DST offset the value does not have, moving
 * an event by two hours on the two days a year that anyone would notice.
 */
export function shiftLocalDateTime(local: string, hours: number): string {
  const parts = LOCAL_DATE_TIME.exec(local);
  if (parts === null) throw new Error(`Not a local date-time: ${local}`);

  const [, year, month, day, hour, minute, second] = parts;
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) + hours, Number(minute), Number(second)),
  );

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

/**
 * The colour for an occurrence's bar.
 *
 * The rule itself lives in `@planpal/calendar-core` so web cannot end up with a
 * second, divergent copy (AD-3). This wrapper's only job is to supply the
 * platform's busy colour, which `calendar-core` cannot import — it is
 * deliberately zero-dependency.
 */
export function eventColor(event: OccurrenceItem, colIndex: number): string {
  return resolveEventColor(event, colIndex, theme.colors.busyBlock);
}
