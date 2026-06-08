/**
 * Zero-dependency local-wall-clock → UTC conversion using the runtime's built-in
 * IANA database via `Intl`. This is the source-of-truth rule from the schema:
 * `local_start + timezone_id` is authoritative; UTC is derived. We compute UTC
 * per occurrence (not once on the master) so DST shifts across a series are honored.
 *
 * DST resolution policy ("compatible", matching JS `Date`, java.time, and the
 * Temporal proposal's default):
 *   - the spring-forward GAP (a local time that does not exist) shifts FORWARD by
 *     the gap length (02:30 on a 02:00->03:00 night resolves to 03:30), and
 *   - the fall-back AMBIGUOUS hour (a local time that occurs twice) takes the
 *     EARLIER of the two instants.
 * Both are handled and tested here (see timezone.test.ts). NOTE: the Postgres
 * `events_derive_utc()` trigger derives `utc_*` independently via `AT TIME ZONE`,
 * whose gap/fold resolution differs; reconciling the two derivations is a tracked
 * M2 follow-up (see MONTH_1_PLAN.md).
 */

/** A naive wall-clock instant, parsed from a `LocalDateTime` string. */
export interface Civil {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Parse a `LocalDateTime` ("YYYY-MM-DDTHH:mm[:ss]"). Throws on malformed input. */
export function parseLocal(value: string): Civil {
  const m = LOCAL_RE.exec(value);
  if (!m) {
    throw new RangeError(`Invalid LocalDateTime: ${JSON.stringify(value)}`);
  }
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: m[6] === undefined ? 0 : Number(m[6]),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Format a {@link Civil} back to a `LocalDateTime` (always with seconds). */
export function formatLocal(c: Civil): string {
  return `${String(c.year).padStart(4, '0')}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;
}

/**
 * Offset (ms) of `timeZone` at the instant `utcMs`, i.e. `wallClock - utc`.
 * Returns the value such that `utcMs + offset` printed as UTC equals the zone's
 * local wall clock.
 */
function offsetMsAt(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - utcMs;
}

const pad4 = (n: number): string => String(n).padStart(4, '0');

const DAY_MS = 86_400_000;

/**
 * Resolve the naive wall-clock value `asUtc` (the local fields read as if they
 * were UTC) to a real UTC instant in `timeZone`, applying the "compatible" DST
 * rule for the gap/fold cases. Returns epoch-ms.
 */
function resolveToUtcMs(asUtc: number, timeZone: string): number {
  // Bracket any single DST transition near the wall time by probing the offset a
  // day on either side; DST transitions are far more than a day apart, so at most
  // one falls inside the window.
  const offsetBefore = offsetMsAt(asUtc - DAY_MS, timeZone);
  const offsetAfter = offsetMsAt(asUtc + DAY_MS, timeZone);

  // Common case: no transition nearby — a single, unambiguous offset applies.
  if (offsetBefore === offsetAfter) {
    return asUtc - offsetBefore;
  }

  // A transition is in range. Each offset yields a candidate instant; a candidate
  // is VALID only if the zone's actual offset at that instant reproduces the offset
  // we used (i.e. the wall time really exists under that offset).
  const candBefore = asUtc - offsetBefore;
  const candAfter = asUtc - offsetAfter;
  const beforeValid = offsetMsAt(candBefore, timeZone) === offsetBefore;
  const afterValid = offsetMsAt(candAfter, timeZone) === offsetAfter;

  if (beforeValid && afterValid) {
    return Math.min(candBefore, candAfter); // fall-back fold: earlier instant
  }
  if (beforeValid) return candBefore;
  if (afterValid) return candAfter;
  return Math.max(candBefore, candAfter); // spring-forward gap: shift forward
}

/**
 * Convert a naive local wall-clock time in `timeZone` to a UTC `IsoDateTime`
 * string ("YYYY-MM-DDTHH:mm:ssZ"). An invalid `timeZone` throws (via `Intl`).
 * Gap/fold cases follow the "compatible" policy documented at the top of the file.
 */
export function localToUtc(local: Civil, timeZone: string): string {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const d = new Date(resolveToUtcMs(asUtc, timeZone));
  return `${pad4(d.getUTCFullYear())}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}
