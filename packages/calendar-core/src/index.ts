/**
 * @planpal/calendar-core — pure calendar maths, overlap layout and holidays.
 *
 * Zero dependencies by design (AD-2). Mobile and web each write their own
 * views; everything they would otherwise both have to implement lives here, so
 * the rules cannot fork across platforms (AD-3). If a calendar rule appears in
 * a `.tsx` on both sides, it belongs in this package instead.
 */
export { today, currentYearMonth, buildMonthGrid, buildWeekDays } from './grid';
export { layoutDay, hoursSinceMidnight } from './layout';
export { getHolidayName } from './holidays';
export { fmtTime, fmtMonthHeader, fmtDayLabel, fmtHourLabel } from './format';
export type { CalendarDay, DayOccurrence, PositionedOccurrence } from './types';
