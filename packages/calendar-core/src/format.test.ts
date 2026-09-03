import { describe, expect, it } from 'vitest';
import { fmtDayLabel, fmtHourLabel, fmtMonthHeader, fmtTime } from './format.js';

describe('fmtTime', () => {
  it.each([
    ['2026-06-08T00:00:00', '12:00 AM'], // midnight is 12 AM, not 0 AM
    ['2026-06-08T00:30:00', '12:30 AM'],
    ['2026-06-08T09:05:00', '9:05 AM'],
    ['2026-06-08T11:59:00', '11:59 AM'],
    ['2026-06-08T12:00:00', '12:00 PM'], // noon is 12 PM, not 0 PM
    ['2026-06-08T13:00:00', '1:00 PM'],
    ['2026-06-08T23:45:00', '11:45 PM'],
  ])('%s -> %s', (input, expected) => {
    expect(fmtTime(input)).toBe(expected);
  });

  it('accepts a value without seconds', () => {
    expect(fmtTime('2026-06-08T09:30')).toBe('9:30 AM');
  });

  it('returns an empty string for an unparseable value', () => {
    expect(fmtTime('not-a-datetime')).toBe('');
  });
});

describe('fmtMonthHeader', () => {
  it('renders month and year', () => {
    expect(fmtMonthHeader(2026, 6)).toBe('June 2026');
    expect(fmtMonthHeader(2026, 1)).toBe('January 2026');
    expect(fmtMonthHeader(2026, 12)).toBe('December 2026');
  });
});

describe('fmtDayLabel', () => {
  it('renders weekday and day number', () => {
    expect(fmtDayLabel('2026-06-08')).toBe('Mon 8');
    expect(fmtDayLabel('2026-06-14')).toBe('Sun 14');
  });

  it('does not zero-pad the day', () => {
    expect(fmtDayLabel('2026-06-01')).toBe('Mon 1');
  });
});

describe('fmtHourLabel', () => {
  it.each([
    [0, '12 AM'],
    [1, '1 AM'],
    [11, '11 AM'],
    [12, '12 PM'],
    [13, '1 PM'],
    [23, '11 PM'],
  ])('%s -> %s', (hour, expected) => {
    expect(fmtHourLabel(hour)).toBe(expected);
  });
});
