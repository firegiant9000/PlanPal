import { describe, expect, it } from 'vitest';
import { buildMonthGrid, buildWeekDays, currentYearMonth, today } from './grid.js';

const PINNED = '2026-06-15';

describe('today', () => {
  it('formats the current local date as YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reflects the local date, not UTC', () => {
    // A UTC-based implementation is off by a day for anyone west of Greenwich
    // during their evening — the highlighted "today" is simply wrong.
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    expect(today()).toBe(expected);
  });
});

describe('currentYearMonth', () => {
  it('returns a 1-indexed month, not the 0-indexed one Date gives', () => {
    // The whole reason this helper exists: getMonth() is 0-indexed while every
    // other month value in this package is 1-indexed, and each app doing the
    // +1 itself is a standing invitation to get it wrong once.
    const now = new Date();
    expect(currentYearMonth()).toEqual({
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    });
  });

  it('is in range', () => {
    const { month } = currentYearMonth();
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });
});

describe('buildMonthGrid', () => {
  it('is always 6 rows of 7, whatever the month', () => {
    // Sizing to the month makes the sheet jump vertically when paging.
    for (const [y, m] of [
      [2026, 2], // 28 days starting Sunday — the shortest possible layout
      [2026, 6],
      [2027, 2],
      [2028, 2], // leap February
      [2026, 8],
    ] as Array<[number, number]>) {
      const grid = buildMonthGrid(y, m, PINNED);
      expect(grid, `${y}-${m} row count`).toHaveLength(6);
      for (const week of grid) expect(week).toHaveLength(7);
    }
  });

  it('starts every row on a Sunday', () => {
    const grid = buildMonthGrid(2026, 6, PINNED);
    for (const week of grid) {
      const d = new Date(week[0]!.year, week[0]!.month - 1, week[0]!.day);
      expect(d.getDay()).toBe(0);
    }
  });

  it('marks padding days from adjacent months', () => {
    // June 2026 starts on a Monday, so exactly one leading pad day.
    const grid = buildMonthGrid(2026, 6, PINNED);
    const flat = grid.flat();

    expect(flat[0]).toMatchObject({ year: 2026, month: 5, day: 31, isOutsideMonth: true });
    expect(flat[1]).toMatchObject({ year: 2026, month: 6, day: 1, isOutsideMonth: false });
    expect(flat.filter((d) => !d.isOutsideMonth)).toHaveLength(30);
  });

  it('rolls the year backwards at January', () => {
    const flat = buildMonthGrid(2026, 1, PINNED).flat();
    const leading = flat.filter((d) => d.isOutsideMonth && d.month === 12);
    expect(leading.every((d) => d.year === 2025)).toBe(true);
  });

  it('rolls the year forwards at December', () => {
    const flat = buildMonthGrid(2026, 12, PINNED).flat();
    const trailing = flat.filter((d) => d.isOutsideMonth && d.month === 1);
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing.every((d) => d.year === 2027)).toBe(true);
  });

  it('handles a leap February', () => {
    const flat = buildMonthGrid(2028, 2, PINNED).flat();
    const inMonth = flat.filter((d) => !d.isOutsideMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth.at(-1)!.date).toBe('2028-02-29');
  });

  it('produces contiguous, correctly formatted dates', () => {
    const flat = buildMonthGrid(2026, 6, PINNED).flat();
    for (let i = 1; i < flat.length; i++) {
      const prev = new Date(`${flat[i - 1]!.date}T00:00:00Z`).getTime();
      const cur = new Date(`${flat[i]!.date}T00:00:00Z`).getTime();
      expect(cur - prev, `gap before ${flat[i]!.date}`).toBe(86_400_000);
    }
    expect(flat.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
  });

  it('flags weekends and today', () => {
    const flat = buildMonthGrid(2026, 6, PINNED).flat();
    const saturday = flat.find((d) => d.date === '2026-06-06');
    const monday = flat.find((d) => d.date === '2026-06-08');

    expect(saturday!.isWeekend).toBe(true);
    expect(monday!.isWeekend).toBe(false);
    expect(flat.filter((d) => d.isToday)).toHaveLength(1);
    expect(flat.find((d) => d.isToday)!.date).toBe(PINNED);
  });

  it('marks nothing as today when the pinned date is outside the grid', () => {
    expect(
      buildMonthGrid(2026, 6, '1999-01-01')
        .flat()
        .some((d) => d.isToday),
    ).toBe(false);
  });
});

describe('buildWeekDays', () => {
  it('returns Sunday through Saturday containing the anchor', () => {
    const week = buildWeekDays('2026-06-10', PINNED); // a Wednesday
    expect(week).toHaveLength(7);
    expect(week[0]!.date).toBe('2026-06-07');
    expect(week[6]!.date).toBe('2026-06-13');
    expect(week.some((d) => d.date === '2026-06-10')).toBe(true);
  });

  it('returns the same week whichever day in it is the anchor', () => {
    const fromSunday = buildWeekDays('2026-06-07', PINNED).map((d) => d.date);
    const fromSaturday = buildWeekDays('2026-06-13', PINNED).map((d) => d.date);
    expect(fromSaturday).toEqual(fromSunday);
  });

  it('crosses a month boundary', () => {
    const week = buildWeekDays('2026-07-01', PINNED); // Wednesday
    expect(week[0]!.date).toBe('2026-06-28');
    expect(week[6]!.date).toBe('2026-07-04');
  });

  it('crosses a year boundary', () => {
    const week = buildWeekDays('2027-01-01', PINNED); // Friday
    expect(week[0]!.date).toBe('2026-12-27');
    expect(week[6]!.date).toBe('2027-01-02');
  });

  it('steps correctly across a DST spring-forward', () => {
    // 2026-03-08 is the US spring-forward. Adding 86_400_000ms to a local Date
    // across this boundary lands on the wrong calendar day; going through the
    // Date constructor does not.
    const week = buildWeekDays('2026-03-11', PINNED);
    expect(week.map((d) => d.date)).toEqual([
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
      '2026-03-11',
      '2026-03-12',
      '2026-03-13',
      '2026-03-14',
    ]);
  });

  it('steps correctly across a DST fall-back', () => {
    const week = buildWeekDays('2026-11-04', PINNED);
    expect(week.map((d) => d.date)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
  });

  it('never marks week days as outside the month', () => {
    // A week strip shows a flat run of days; there is no "current month" for a
    // cell to be outside of.
    expect(buildWeekDays('2026-07-01', PINNED).every((d) => !d.isOutsideMonth)).toBe(true);
  });
});
