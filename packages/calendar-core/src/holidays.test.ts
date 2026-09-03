import { describe, expect, it } from 'vitest';
import { getHolidayName } from './holidays.js';

describe('fixed-date holidays', () => {
  it.each([
    ['2026-01-01', "New Year's Day"], // Thursday
    ['2026-06-19', 'Juneteenth'], // Friday
    ['2026-07-04', 'Independence Day'], // Saturday -> observed Friday
    ['2026-12-25', 'Christmas Day'], // Friday
  ])('%s', (date, name) => {
    // Independence Day 2026 falls on a Saturday, so the observed date moves.
    if (date === '2026-07-04') {
      expect(getHolidayName('2026-07-03')).toBe(name);
      expect(getHolidayName(date)).toBeUndefined();
    } else {
      expect(getHolidayName(date)).toBe(name);
    }
  });

  it('observes a Sunday holiday on the following Monday', () => {
    // 2027-12-25 is a Saturday; 2022-12-25 was a Sunday. Use a known Sunday:
    // 2028-01-01 falls on a Saturday, 2023-01-01 was a Sunday.
    // 2033-01-01 is a Saturday. Pick 2034-01-01 (Sunday).
    expect(getHolidayName('2034-01-02')).toBe("New Year's Day");
    expect(getHolidayName('2034-01-01')).toBeUndefined();
  });

  it('observes a Saturday holiday on the preceding Friday', () => {
    // 2026-07-04 is a Saturday.
    expect(getHolidayName('2026-07-03')).toBe('Independence Day');
  });
});

describe('floating holidays', () => {
  it.each([
    ['2026-01-19', 'Martin Luther King Jr. Day'], // 3rd Monday of January
    ['2026-02-16', "Presidents' Day"], // 3rd Monday of February
    ['2026-05-25', 'Memorial Day'], // last Monday of May
    ['2026-09-07', 'Labor Day'], // 1st Monday of September
    ['2026-10-12', 'Columbus Day'], // 2nd Monday of October
    ['2026-11-26', 'Thanksgiving Day'], // 4th Thursday of November
  ])('%s is %s', (date, name) => {
    expect(getHolidayName(date)).toBe(name);
  });

  it('tracks the floating date across years rather than fixing it', () => {
    // If these were hard-coded the second assertion would fail.
    expect(getHolidayName('2026-11-26')).toBe('Thanksgiving Day');
    expect(getHolidayName('2027-11-25')).toBe('Thanksgiving Day');
    expect(getHolidayName('2028-11-23')).toBe('Thanksgiving Day');
  });

  it('puts Memorial Day on the LAST Monday, not the fourth', () => {
    // May 2027 has five Mondays; a "4th Monday" implementation lands on the 24th.
    expect(getHolidayName('2027-05-31')).toBe('Memorial Day');
    expect(getHolidayName('2027-05-24')).toBeUndefined();
  });
});

describe('non-holidays', () => {
  it.each(['2026-06-08', '2026-03-15', '2026-08-20'])('%s is not a holiday', (date) => {
    expect(getHolidayName(date)).toBeUndefined();
  });
});

describe('year handling', () => {
  it('computes any requested year, not a pre-expanded window', () => {
    // A user paging back to 2019 should still see holidays.
    expect(getHolidayName('2019-07-04')).toBe('Independence Day');
    expect(getHolidayName('2040-12-25')).toBe('Christmas Day');
  });

  it('returns the same answer on a repeat call (memoisation is transparent)', () => {
    const first = getHolidayName('2026-11-26');
    const second = getHolidayName('2026-11-26');
    expect(second).toBe(first);
    expect(second).toBe('Thanksgiving Day');
  });
});
