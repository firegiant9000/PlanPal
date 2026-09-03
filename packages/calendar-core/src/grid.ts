/** Month and week grid construction. Extracted from apps/mobile (T17). */
import type { CalendarDay } from './types.js';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Today's date in the device's local timezone.
 *
 * A function, not a module constant. A constant is evaluated once when the
 * bundle loads, so a session left open across midnight — or a device that
 * changes timezone mid-flight — keeps highlighting the wrong day until the app
 * is force-quit.
 */
export function today(): string {
  return fmtDate(new Date());
}

/**
 * The current local year and 1-indexed month — the month a calendar opens on.
 *
 * Here rather than in each app so no view needs to touch `Date` directly, and
 * so both platforms share the same off-by-one handling: `getMonth()` is
 * 0-indexed while every other month value in this package is 1-indexed.
 */
export function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function makeDay(
  year: number,
  month: number,
  day: number,
  isOutsideMonth: boolean,
  todayDate: string,
): CalendarDay {
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const dow = new Date(year, month - 1, day).getDay();
  return {
    date,
    year,
    month,
    day,
    isOutsideMonth,
    isToday: date === todayDate,
    isWeekend: dow === 0 || dow === 6,
  };
}

/**
 * Build the 6x7 grid of days for a given (year, month), starting on Sunday.
 *
 * Always six rows. Sizing the grid to the month — five rows for a short one,
 * six for a long one — makes the whole sheet jump vertically as the user pages
 * between months.
 *
 * `todayDate` is injectable so callers (and tests) can pin "today" rather than
 * depending on the clock. It defaults to the real one.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  todayDate: string = today(),
): CalendarDay[][] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const startDow = firstOfMonth.getDay();

  const cells: CalendarDay[] = [];

  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push(makeDay(prevYear, prevMonth, prevLastDay - i, true, todayDate));
  }

  for (let d = 1; d <= lastDay; d++) {
    cells.push(makeDay(year, month, d, false, todayDate));
  }

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  let trail = 1;
  while (cells.length < 42) {
    cells.push(makeDay(nextYear, nextMonth, trail++, true, todayDate));
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * The seven days of the week containing `anchorDate`, starting on Sunday.
 *
 * Stepping goes through the Date constructor rather than adding 86_400_000ms
 * to a local-time Date. On a DST boundary a day is 23 or 25 hours long, so
 * millisecond arithmetic lands on the wrong calendar date — and in zones that
 * transition at midnight, skips a day outright.
 */
export function buildWeekDays(anchorDate: string, todayDate: string = today()): CalendarDay[] {
  const [y, m, d] = anchorDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(y, m - 1, d).getDay();

  return Array.from({ length: 7 }, (_, i) => {
    // Date normalises out-of-range days: day 0 becomes the last day of the
    // previous month, day 32 rolls into the next.
    const dt = new Date(y, m - 1, d - dow + i);
    return makeDay(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), false, todayDate);
  });
}
