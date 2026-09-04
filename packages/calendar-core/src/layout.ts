/**
 * Overlap-column packing for a single day. Extracted from DayTimeSheet (T17).
 *
 * This is the piece §7 singles out as the one that must not fork across
 * platforms: it is real logic, it was interleaved with JSX, and two
 * independent implementations would drift within a sprint.
 */
import type { DayOccurrence, PositionedOccurrence } from './types';

/** Hours since midnight, as a fraction. `09:30` -> 9.5. */
export function hoursSinceMidnight(localDateTime: string): number {
  const time = /[T ](\d{2}):(\d{2})/.exec(localDateTime);
  if (!time) return 0;
  return Number(time[1]) + Number(time[2]) / 60;
}

const HOURS_PER_DAY = 24;

/**
 * The height given to an occurrence with no usable duration.
 *
 * A zero-length occurrence still has to be visible and tappable, but it must
 * not claim the rest of the day: clamping it to midnight-to-midnight (the
 * previous behaviour) made a single 17:00 point event overlap every evening
 * event on the sheet and halve their widths.
 */
const MIN_HOURS = 0.25;

/** The `YYYY-MM-DD` part, for comparing which day an endpoint falls on. */
function datePart(localDateTime: string): string {
  return localDateTime.slice(0, 10);
}

/**
 * Place a day's occurrences into non-overlapping columns.
 *
 * Two passes. The first assigns each occurrence the leftmost column free at
 * its start time. The second sets `columnCount` per *cluster* of transitively
 * overlapping occurrences, so every member of a visual group renders at the
 * same width.
 *
 * That second pass is a fix, not a port. The original compared each occurrence
 * only against those it overlapped directly, which breaks on a chain: with
 * A 09:00-10:00, B 09:30-11:00 and C 10:30-11:30, A and C do not overlap, so A
 * computed 2 columns while B computed 3. A rendered half-width, B a third, and
 * they visibly disagreed about how wide the group was. Clustering by
 * transitive closure gives all three the same answer.
 */
export function layoutDay<T extends DayOccurrence>(
  occurrences: readonly T[],
): PositionedOccurrence<T>[] {
  const timed = occurrences.filter((o) => !o.isVariableSchedule);

  // Sort by start, then longest-first. The secondary key matters: without it,
  // equal-start occurrences pack in input order, so the same day can render
  // differently depending on the order the API happened to return rows in.
  const sorted = [...timed].sort((a, b) => {
    const byStart = a.localStart.localeCompare(b.localStart);
    if (byStart !== 0) return byStart;
    return b.localEnd.localeCompare(a.localEnd);
  });

  interface Placed {
    occurrence: T;
    start: number;
    end: number;
    column: number;
  }

  const placed: Placed[] = [];
  // columnEnds[i] is the end time of the last occurrence placed in column i.
  const columnEnds: number[] = [];

  for (const occurrence of sorted) {
    const start = hoursSinceMidnight(occurrence.localStart);
    let end: number;

    if (datePart(occurrence.localEnd) > datePart(occurrence.localStart)) {
      // Ends on a later day: it runs to the end of this one. Comparing only
      // time-of-day (the previous behaviour) made a 25-hour event that started
      // 09:00 and ended 10:00 the next day render as a one-hour bar, and it
      // failed to claim column space against the afternoon events it really
      // overlaps. Splitting across days is a later concern.
      end = HOURS_PER_DAY;
    } else {
      end = hoursSinceMidnight(occurrence.localEnd);
      if (end < start) {
        // Same date but the end time is behind the start: read as crossing
        // midnight, and run to the end of the day.
        end = HOURS_PER_DAY;
      } else if (end === start) {
        // Zero-length. A sliver, not the rest of the day — see MIN_HOURS.
        end = Math.min(start + MIN_HOURS, HOURS_PER_DAY);
      }
    }

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    placed.push({ occurrence, start, end, column });
  }

  // Second pass: cluster by transitive overlap. Because `placed` is sorted by
  // start, a cluster ends the moment an occurrence starts at or after the
  // furthest end seen so far.
  const result: PositionedOccurrence<T>[] = [];
  let clusterStartIndex = 0;
  let clusterEnd = -Infinity;

  const flush = (endIndex: number) => {
    const members = placed.slice(clusterStartIndex, endIndex);
    if (members.length === 0) return;
    const columnCount = Math.max(...members.map((m) => m.column)) + 1;
    for (const m of members) {
      result.push({
        occurrence: m.occurrence,
        topFraction: m.start / HOURS_PER_DAY,
        heightFraction: (m.end - m.start) / HOURS_PER_DAY,
        column: m.column,
        columnCount,
      });
    }
  };

  for (let i = 0; i < placed.length; i++) {
    const item = placed[i]!;
    if (item.start >= clusterEnd) {
      flush(i);
      clusterStartIndex = i;
      clusterEnd = item.end;
    } else {
      clusterEnd = Math.max(clusterEnd, item.end);
    }
  }
  flush(placed.length);

  return result;
}
