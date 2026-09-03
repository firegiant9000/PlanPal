import { describe, expect, it } from 'vitest';
import { hoursSinceMidnight, layoutDay } from './layout.js';
import type { DayOccurrence } from './types.js';

function occ(start: string, end: string, extra: Partial<DayOccurrence> = {}) {
  return {
    localStart: `2026-06-08T${start}:00`,
    localEnd: `2026-06-08T${end}:00`,
    ...extra,
  };
}

describe('hoursSinceMidnight', () => {
  it.each([
    ['2026-06-08T00:00:00', 0],
    ['2026-06-08T09:30:00', 9.5],
    ['2026-06-08T12:00:00', 12],
    ['2026-06-08T23:45:00', 23.75],
    ['2026-06-08T09:30', 9.5], // seconds optional
    ['2026-06-08 09:30:00', 9.5], // space separator
  ])('%s -> %s', (input, expected) => {
    expect(hoursSinceMidnight(input)).toBe(expected);
  });

  it('returns 0 for an unparseable value rather than NaN', () => {
    // NaN propagates into a style value and the bar disappears with no error.
    expect(hoursSinceMidnight('nonsense')).toBe(0);
  });
});

describe('layoutDay positioning', () => {
  it('expresses position as a fraction of the day, not pixels', () => {
    const [placed] = layoutDay([occ('06:00', '12:00')]);
    expect(placed!.topFraction).toBeCloseTo(0.25);
    expect(placed!.heightFraction).toBeCloseTo(0.25);
  });

  it('places a 30-minute event at 1/48 of the day', () => {
    const [placed] = layoutDay([occ('09:00', '09:30')]);
    expect(placed!.heightFraction).toBeCloseTo(1 / 48);
  });

  it('returns an empty list for an empty day', () => {
    expect(layoutDay([])).toEqual([]);
  });

  it('excludes variable-schedule placeholders', () => {
    // They have no concrete times; the view surfaces them separately.
    const result = layoutDay([
      occ('09:00', '10:00'),
      occ('11:00', '12:00', { isVariableSchedule: true }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.occurrence.localStart).toContain('09:00');
  });

  it('clamps an occurrence that ends before it starts to the end of the day', () => {
    // Crossing midnight would otherwise produce a negative height, rendering
    // as an inverted bar or vanishing silently.
    const [placed] = layoutDay([occ('23:00', '01:00')]);
    expect(placed!.heightFraction).toBeGreaterThan(0);
    expect(placed!.topFraction + placed!.heightFraction).toBeCloseTo(1);
  });

  it('clamps a zero-length occurrence rather than emitting height 0', () => {
    const [placed] = layoutDay([occ('09:00', '09:00')]);
    expect(placed!.heightFraction).toBeGreaterThan(0);
  });
});

describe('layoutDay column packing', () => {
  it('gives non-overlapping occurrences a single full-width column', () => {
    const result = layoutDay([occ('09:00', '10:00'), occ('11:00', '12:00')]);
    expect(result.map((r) => r.column)).toEqual([0, 0]);
    expect(result.map((r) => r.columnCount)).toEqual([1, 1]);
  });

  it('treats back-to-back occurrences as non-overlapping', () => {
    // An event ending at 10:00 and one starting at 10:00 do not overlap;
    // rendering them half-width each wastes half the sheet.
    const result = layoutDay([occ('09:00', '10:00'), occ('10:00', '11:00')]);
    expect(result.every((r) => r.columnCount === 1)).toBe(true);
  });

  it('splits two overlapping occurrences into two columns', () => {
    const result = layoutDay([occ('09:00', '11:00'), occ('10:00', '12:00')]);
    expect(result.map((r) => r.column).sort()).toEqual([0, 1]);
    expect(result.every((r) => r.columnCount === 2)).toBe(true);
  });

  it('reuses a column for a later non-overlapping occurrence in the same cluster', () => {
    // A and C do not overlap, so they share column 0 and the cluster needs
    // only two columns — not three. Giving every member its own column would
    // waste a third of the sheet.
    const result = layoutDay([
      occ('09:00', '10:00'), // A -> col 0
      occ('09:30', '11:00'), // B -> col 1
      occ('10:30', '11:30'), // C -> col 0 again
    ]);
    const byStart = new Map(result.map((r) => [r.occurrence.localStart.slice(11, 16), r]));
    expect(byStart.get('09:00')!.column).toBe(0);
    expect(byStart.get('09:30')!.column).toBe(1);
    expect(byStart.get('10:30')!.column).toBe(0);
    expect(result.every((r) => r.columnCount === 2)).toBe(true);
  });

  it('agrees on width across a transitively-overlapping cluster', () => {
    // The bug this fixes. The original compared each occurrence only against
    // those it overlapped DIRECTLY. Here the 09:00 bar overlaps only the 09:15
    // one (column 1), so it computed columnCount 2, while the other three
    // computed 3 — verified against a reimplementation of the old algorithm,
    // which yields 2, 3, 3, 3 for exactly this input.
    //
    // The result was one visual cluster whose first bar rendered at half width
    // and whose neighbours rendered at a third, overlapping each other.
    const result = layoutDay([
      occ('09:00', '09:30'),
      occ('09:15', '12:00'),
      occ('10:00', '10:30'),
      occ('10:15', '13:00'),
    ]);

    expect(result).toHaveLength(4);
    expect(
      result.map((r) => r.columnCount),
      'every member of a cluster must report the same width',
    ).toEqual([3, 3, 3, 3]);
  });

  it('keeps separate clusters independent', () => {
    const result = layoutDay([
      occ('09:00', '11:00'), // cluster 1
      occ('10:00', '12:00'), // cluster 1
      occ('15:00', '16:00'), // cluster 2, alone
    ]);
    const byStart = new Map(result.map((r) => [r.occurrence.localStart.slice(11, 16), r]));
    expect(byStart.get('09:00')!.columnCount).toBe(2);
    expect(byStart.get('10:00')!.columnCount).toBe(2);
    expect(byStart.get('15:00')!.columnCount).toBe(1);
  });

  it('reuses a freed column after an occurrence ends', () => {
    const result = layoutDay([
      occ('09:00', '10:00'), // col 0
      occ('09:30', '10:30'), // col 1
      occ('10:00', '11:00'), // col 0 is free again
    ]);
    const byStart = new Map(result.map((r) => [r.occurrence.localStart.slice(11, 16), r]));
    expect(byStart.get('10:00')!.column).toBe(0);
  });

  it('is deterministic regardless of input order', () => {
    // Without a stable secondary sort key, the same day renders differently
    // depending on the order the API happened to return rows in.
    const events = [occ('09:00', '12:00'), occ('09:00', '10:00'), occ('10:30', '11:00')];
    const forward = layoutDay(events);
    const reversed = layoutDay([...events].reverse());

    const key = (r: (typeof forward)[number]) =>
      `${r.occurrence.localStart}|${r.column}|${r.columnCount}`;
    expect(forward.map(key).sort()).toEqual(reversed.map(key).sort());
  });

  it('places the longer of two equal-start occurrences first', () => {
    const result = layoutDay([occ('09:00', '10:00'), occ('09:00', '12:00')]);
    const first = result.find((r) => r.column === 0)!;
    expect(first.occurrence.localEnd).toContain('12:00');
  });

  it('handles a fully-nested occurrence', () => {
    const result = layoutDay([occ('09:00', '17:00'), occ('10:00', '11:00')]);
    expect(result.every((r) => r.columnCount === 2)).toBe(true);
  });

  it('stacks many mutually-overlapping occurrences into distinct columns', () => {
    const result = layoutDay([
      occ('09:00', '17:00'),
      occ('09:15', '17:00'),
      occ('09:30', '17:00'),
      occ('09:45', '17:00'),
    ]);
    expect(new Set(result.map((r) => r.column)).size).toBe(4);
    expect(result.every((r) => r.columnCount === 4)).toBe(true);
  });

  it('keeps every column index inside its columnCount', () => {
    // A column >= columnCount computes a left offset past 100% and the bar
    // renders off-screen.
    const result = layoutDay([
      occ('08:00', '09:30'),
      occ('09:00', '10:00'),
      occ('09:15', '11:00'),
      occ('13:00', '14:00'),
      occ('13:30', '15:00'),
    ]);
    for (const r of result) {
      expect(r.column).toBeGreaterThanOrEqual(0);
      expect(r.column).toBeLessThan(r.columnCount);
    }
  });

  it('preserves the original occurrence object', () => {
    const input = occ('09:00', '10:00', { isVariableSchedule: false });
    const [placed] = layoutDay([input]);
    expect(placed!.occurrence).toBe(input);
  });

  it('does not mutate its input', () => {
    const events = [occ('11:00', '12:00'), occ('09:00', '10:00')];
    const snapshot = JSON.stringify(events);
    layoutDay(events);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});
