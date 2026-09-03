/**
 * US federal holidays as a static lookup. The plan specifies a public iCal feed
 * as the eventual source; for M2 we bundle the fixed-rule set since the recurrence
 * engine handles the RRULE → date expansion server-side. Observed dates (Monday
 * substitution when a holiday falls on Sunday) are pre-computed per year.
 *
 * Only the current year and the next two are pre-expanded; the calendar view
 * won't need years beyond that range in normal use.
 */

type HolidaysByDate = Record<string, string>; // date → name

function computeHolidays(year: number): HolidaysByDate {
  const out: HolidaysByDate = {};

  const add = (month: number, day: number, name: string) => {
    const observed = observedDate(year, month, day);
    out[observed] = name;
  };

  const nthWeekday = (month: number, n: number, weekday: number): string => {
    // e.g. 3rd Monday of January: n=3, weekday=1 (Mon)
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      if (dt.getUTCMonth() !== month - 1) break;
      if (dt.getUTCDay() === weekday) {
        count++;
        if (count === n) return fmtDate(dt);
      }
    }
    return '';
  };

  const lastWeekday = (month: number, weekday: number): string => {
    for (let d = 31; d >= 1; d--) {
      const dt = new Date(Date.UTC(year, month - 1, d));
      if (dt.getUTCMonth() !== month - 1) continue;
      if (dt.getUTCDay() === weekday) return fmtDate(dt);
    }
    return '';
  };

  // Fixed-date federal holidays (with Sunday → Monday observed rule).
  add(1, 1, "New Year's Day");
  add(6, 19, 'Juneteenth');
  add(7, 4, 'Independence Day');
  add(11, 11, 'Veterans Day');
  add(12, 25, 'Christmas Day');

  // Floating holidays.
  const mlk = nthWeekday(1, 3, 1);
  if (mlk) out[mlk] = 'Martin Luther King Jr. Day';
  const pres = nthWeekday(2, 3, 1);
  if (pres) out[pres] = "Presidents' Day";
  const mem = lastWeekday(5, 1);
  if (mem) out[mem] = 'Memorial Day';
  const labor = nthWeekday(9, 1, 1);
  if (labor) out[labor] = 'Labor Day';
  const colum = nthWeekday(10, 2, 1);
  if (colum) out[colum] = 'Columbus Day';
  const thanks = nthWeekday(11, 4, 4);
  if (thanks) out[thanks] = 'Thanksgiving Day';

  return out;
}

function observedDate(year: number, month: number, day: number): string {
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  if (dow === 0) {
    // Sunday → observe Monday.
    return fmtDate(new Date(dt.getTime() + 86_400_000));
  }
  if (dow === 6) {
    // Saturday → observe Friday (not a federal rule, but common in practice).
    return fmtDate(new Date(dt.getTime() - 86_400_000));
  }
  return fmtDate(dt);
}

const fmtDate = (d: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// Memoised per year, computed on first request rather than pre-expanded for a
// fixed range: a user paging back through 2019 should still see holidays.
const cache = new Map<number, HolidaysByDate>();

function getHolidays(year: number): HolidaysByDate {
  if (!cache.has(year)) cache.set(year, computeHolidays(year));
  return cache.get(year)!;
}

/** Return the holiday name for a YYYY-MM-DD date, or undefined if none. */
export function getHolidayName(date: string): string | undefined {
  const year = Number(date.slice(0, 4));
  return getHolidays(year)[date];
}
