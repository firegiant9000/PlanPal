/** Calendar math utilities used by MonthView, WeekStrip, and DayTimeSheet. */

export interface CalendarDay {
  date: string; // YYYY-MM-DD
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  /** True when this cell is padding from an adjacent month. */
  isOutsideMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

/**
 * Today's date in the device's local timezone.
 *
 * This is a function, not a module constant. A constant is evaluated once when
 * the bundle loads, so a session left open across midnight (or a device that
 * changes timezone mid-flight) keeps highlighting the wrong day until the app
 * is force-quit.
 */
export function today(): string {
  return fmtDate(new Date());
}

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Build the 6x7 grid of days for a given (year, month). Grid starts on Sunday.
 *
 * Always six rows. Sizing the grid to the month (5 rows for a short month, 6
 * for a long one) makes the whole sheet jump vertically when the user pages
 * between months.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[][] {
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0).getDate();
  const startDow = firstOfMonth.getDay(); // 0=Sun

  const cells: CalendarDay[] = [];

  // Leading days from previous month.
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const prevLastDay = new Date(prevYear, prevMonth, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevLastDay - i;
    cells.push(makeDay(prevYear, prevMonth, d, true));
  }

  // Current month.
  for (let d = 1; d <= lastDay; d++) {
    cells.push(makeDay(year, month, d, false));
  }

  // Trailing days from next month, padded to a fixed 6x7.
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  let trail = 1;
  while (cells.length < 42) {
    cells.push(makeDay(nextYear, nextMonth, trail++, true));
  }

  // Split into weeks.
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

function makeDay(year: number, month: number, day: number, isOutsideMonth: boolean): CalendarDay {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${year}-${pad(month)}-${pad(day)}`;
  const dow = new Date(year, month - 1, day).getDay();
  return {
    date,
    year,
    month,
    day,
    isOutsideMonth,
    isToday: date === today(),
    isWeekend: dow === 0 || dow === 6,
  };
}

/**
 * The seven days of the week containing `anchorDate`, starting on Sunday.
 *
 * Day stepping goes through the Date constructor rather than adding
 * 86_400_000ms to a local-time Date. On a DST boundary a "day" is 23 or 25
 * hours long, so millisecond arithmetic silently lands on the wrong calendar
 * date (and in zones that transition at midnight, skips a day outright).
 */
export function buildWeekDays(anchorDate: string): CalendarDay[] {
  const [y, m, d] = anchorDate.split('-').map(Number) as [number, number, number];
  const anchor = new Date(y, m - 1, d);
  const dow = anchor.getDay(); // 0=Sun

  return Array.from({ length: 7 }, (_, i) => {
    // Date normalizes out-of-range days (e.g. day 0 -> last day of prev month).
    const dt = new Date(y, m - 1, d - dow + i);
    return makeDay(dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), false);
  });
}

/** Format "June 2026" for a month header. */
export function fmtMonthHeader(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/** Format "Mon 8" for a week-strip header. */
export function fmtDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  const dayName = dt.toLocaleString('en-US', { weekday: 'short' });
  return `${dayName} ${d}`;
}

/** Format a time string like "9:30 AM" from a LocalDateTime. */
export function fmtTime(localDateTime: string): string {
  const timePart = localDateTime.slice(11, 16);
  const [hStr, mStr] = timePart.split(':') as [string, string];
  const h = Number(hStr);
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${ampm}`;
}

/** Return the hour offset (0-23) and fractional minute for a LocalDateTime. */
export function timeToHourFraction(localDateTime: string): number {
  const [hStr, mStr] = localDateTime.slice(11, 16).split(':') as [string, string];
  return Number(hStr) + Number(mStr) / 60;
}
