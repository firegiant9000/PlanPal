/**
 * Minimal RFC 5545 RRULE parsing + occurrence-date iteration — the Phase 4
 * kickoff subset. The engine produces the calendar DATES on which a series
 * recurs; `expand.ts` attaches the time-of-day, exceptions, and UTC derivation.
 *
 * KICKOFF SUBSET (enough for weekly / bi-weekly / custom-day class schedules):
 *   FREQ = DAILY | WEEKLY · INTERVAL · BYDAY · COUNT · UNTIL
 * UNSUPPORTED until M2 (throws `UnsupportedRRuleError`, never silently drops):
 *   FREQ = MONTHLY | YEARLY (birthday auto-events, etc.), BYMONTHDAY, BYSETPOS,
 *   BYMONTH, WKST other than the default MO. Full coverage lands in Month 2.
 */
import { UnsupportedRRuleError } from './types.js';

/** JS weekday numbers: Sun=0 … Sat=6 (matches `Date#getUTCDay`). */
const BYDAY_TO_JS: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const DAY_MS = 86_400_000;

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY';
  interval: number;
  /** JS weekday numbers (WEEKLY only); empty = derive from the start weekday. */
  byday: number[];
  count: number | null;
  /** Inclusive UNTIL bound as a UTC epoch-ms instant, or null. */
  untilMs: number | null;
}

const UNTIL_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/;

function parseUntil(raw: string): number {
  const m = UNTIL_RE.exec(raw);
  if (!m) {
    throw new UnsupportedRRuleError(`Unsupported UNTIL value: ${JSON.stringify(raw)}`);
  }
  // Date-only UNTIL is inclusive of the whole day; push to end-of-day UTC.
  const hasTime = m[4] !== undefined;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    hasTime ? Number(m[4]) : 23,
    hasTime ? Number(m[5]) : 59,
    hasTime ? Number(m[6]) : 59,
  );
}

/** Parse an RRULE string into a {@link ParsedRule}. Throws on out-of-subset rules. */
export function parseRRule(rule: string): ParsedRule {
  const parts: Record<string, string> = {};
  for (const segment of rule.trim().split(';')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    if (eq === -1) {
      throw new UnsupportedRRuleError(`Malformed RRULE segment: ${JSON.stringify(segment)}`);
    }
    parts[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1);
  }

  const freq = parts.FREQ?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY') {
    throw new UnsupportedRRuleError(
      `FREQ=${parts.FREQ ?? '(missing)'} is not supported in the Phase 4 kickoff (DAILY/WEEKLY only; MONTHLY/YEARLY land in M2).`,
    );
  }

  for (const unsupported of ['BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'BYYEARDAY', 'BYWEEKNO']) {
    if (parts[unsupported] !== undefined) {
      throw new UnsupportedRRuleError(`${unsupported} is not supported in the Phase 4 kickoff (lands in M2).`);
    }
  }
  if (parts.WKST !== undefined && parts.WKST.toUpperCase() !== 'MO') {
    throw new UnsupportedRRuleError(`WKST=${parts.WKST} is not supported in the Phase 4 kickoff (assumes MO; lands in M2).`);
  }

  let interval = 1;
  if (parts.INTERVAL !== undefined) {
    interval = Number(parts.INTERVAL);
    if (!Number.isInteger(interval) || interval < 1) {
      throw new UnsupportedRRuleError(`Invalid INTERVAL: ${JSON.stringify(parts.INTERVAL)}`);
    }
  }

  const byday: number[] = [];
  if (parts.BYDAY !== undefined) {
    for (const token of parts.BYDAY.split(',')) {
      const day = BYDAY_TO_JS[token.toUpperCase()];
      if (day === undefined) {
        // Ordinal BYDAY (e.g. "2MO") is a MONTHLY/YEARLY feature — out of subset.
        throw new UnsupportedRRuleError(`Unsupported BYDAY token: ${JSON.stringify(token)}`);
      }
      byday.push(day);
    }
  }

  let count: number | null = null;
  if (parts.COUNT !== undefined) {
    count = Number(parts.COUNT);
    if (!Number.isInteger(count) || count < 1) {
      throw new UnsupportedRRuleError(`Invalid COUNT: ${JSON.stringify(parts.COUNT)}`);
    }
  }
  if (parts.COUNT !== undefined && parts.UNTIL !== undefined) {
    throw new UnsupportedRRuleError('RRULE must not set both COUNT and UNTIL (RFC 5545).');
  }

  return {
    freq,
    interval,
    byday,
    count,
    untilMs: parts.UNTIL !== undefined ? parseUntil(parts.UNTIL) : null,
  };
}

// Civil-date helpers. We model each candidate day as a UTC-midnight epoch-ms so
// day arithmetic is plain integer math, free of DST/timezone effects (the zone is
// only applied later, in expand.ts, when deriving the UTC instant).
const civilMidnightMs = (year: number, month: number, day: number): number => Date.UTC(year, month - 1, day);
const jsWeekday = (ms: number): number => new Date(ms).getUTCDay();

/** Hard backstop so a malformed forever-rule can never loop unbounded. */
const MAX_OCCURRENCES = 10_000;

/**
 * Yield the occurrence calendar dates (as UTC-midnight epoch-ms) of a series,
 * in chronological order, from `startMs` up to and including `windowEndMs`.
 *
 * COUNT and UNTIL are evaluated from the series start (DTSTART), NOT from the
 * query window — so a windowed view never miscounts a bounded series.
 */
export function* occurrenceDates(
  rule: ParsedRule,
  startMs: number,
  windowEndMs: number,
): Generator<number> {
  let emitted = 0;
  const withinLimits = (ms: number): boolean => {
    if (rule.count !== null && emitted >= rule.count) return false;
    if (rule.untilMs !== null && ms > rule.untilMs) return false;
    return true;
  };

  if (rule.freq === 'DAILY') {
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const ms = startMs + i * rule.interval * DAY_MS;
      if (!withinLimits(ms)) return;
      if (ms > windowEndMs) return;
      emitted++;
      yield ms;
    }
    return;
  }

  // WEEKLY. Active weeks step by INTERVAL from the (Monday) week containing the
  // start. Within each active week we emit the BYDAY days (or the start weekday)
  // in Mon→Sun order; days before DTSTART are not occurrences and are not counted.
  const bydays = rule.byday.length > 0 ? [...rule.byday].sort((a, b) => a - b) : [jsWeekday(startMs)];
  const WKST = 1; // Monday (kickoff assumes MO; enforced in parseRRule)
  const startDow = jsWeekday(startMs);
  const daysSinceWeekStart = (startDow - WKST + 7) % 7;
  let weekStartMs = startMs - daysSinceWeekStart * DAY_MS;

  for (let week = 0; week < MAX_OCCURRENCES; week++) {
    if (week % rule.interval === 0) {
      for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
        if (!bydays.includes(dow)) continue;
        const offset = (dow - WKST + 7) % 7;
        const ms = weekStartMs + offset * DAY_MS;
        if (ms < startMs) continue; // before DTSTART — not an occurrence
        if (!withinLimits(ms)) return;
        if (ms > windowEndMs) return;
        emitted++;
        yield ms;
      }
    }
    weekStartMs += 7 * DAY_MS;
    if (weekStartMs > windowEndMs) return;
  }
}

export { civilMidnightMs, jsWeekday, DAY_MS };
