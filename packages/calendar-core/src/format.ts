/** Presentation-neutral formatting. Extracted from apps/mobile (T17). */

/** `2026-06-08T09:30:00` -> `9:30 AM`. */
export function fmtTime(localDateTime: string): string {
  const match = /[T ](\d{2}):(\d{2})/.exec(localDateTime);
  if (!match) return '';
  const h = Number(match[1]);
  const minutes = match[2]!;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${minutes} ${ampm}`;
}

/** `June 2026` for a month header. */
export function fmtMonthHeader(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/** `Mon 8` for a week-strip header. */
export function fmtDayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dayName = new Date(y, m - 1, d).toLocaleString('en-US', { weekday: 'short' });
  return `${dayName} ${d}`;
}

/** `9 AM` / `12 PM` for an hour gutter label. */
export function fmtHourLabel(hour: number): string {
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${ampm}`;
}
