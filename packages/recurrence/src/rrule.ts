/**
 * RFC 5545 RRULE parsing + occurrence-date iteration.
 *
 * M1 kickoff subset (DAILY/WEEKLY) extended in M2 to cover the full set of
 * rules PlanPal needs:
 *
 *   FREQ     = DAILY | WEEKLY | MONTHLY | YEARLY
 *   INTERVAL = positive integer (default 1)
 *   BYDAY    = weekday list (MO,TU…) with optional ordinal prefix (+/-N, e.g. "2MO", "-1FR")
 *   BYMONTHDAY = 1..28 (or -1 for last day); MONTHLY/YEARLY only
 *   BYMONTH  = 1..12; YEARLY only
 *   BYSETPOS = ordinal within a set of candidates; typically with BYDAY+BYMONTHDAY
 *   WKST     = week-start (MO default); affects bi-weekly week boundaries
 *   COUNT    = positive integer (mutual exclusion with UNTIL)
 *   UNTIL    = date or datetime (inclusive bound)
 *
 * Unsupported (throws UnsupportedRRuleError, never silently drops):
 *   BYYEARDAY, BYWEEKNO
 */
import { UnsupportedRRuleError } from './types.js';

/** JS weekday numbers: Sun=0 … Sat=6 (matches Date#getUTCDay). */
export const BYDAY_TO_JS: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

export const DAY_MS = 86_400_000;

export interface OrdinalDay {
  ordinal: number | null; // null = no ordinal (plain weekday)
  weekday: number;        // JS weekday 0-6
}

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  /** WEEKLY: plain weekday numbers; MONTHLY/YEARLY: full OrdinalDay entries. */
  byday: OrdinalDay[];
  /** MONTHLY/YEARLY: 1-based day of month, or negative (-1 = last day). */
  bymonthday: number[];
  /** YEARLY: 1-based month numbers. Empty = no restriction. */
  bymonth: number[];
  /** Ordinal position(s) within the candidate set. Empty = no restriction. */
  bysetpos: number[];
  /** Week-start weekday (0=Sun … 6=Sat). Default 1 (Monday). */
  wkst: number;
  count: number | null;
  /** Inclusive UNTIL bound as a UTC epoch-ms instant, or null. */
  untilMs: number | null;
}

const UNTIL_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/;

function parseUntil(raw: string): number {
  const m = UNTIL_RE.exec(raw);
  if (!m) throw new UnsupportedRRuleError(`Unsupported UNTIL value: ${JSON.stringify(raw)}`);
  const hasTime = m[4] !== undefined;
  return Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    hasTime ? Number(m[4]) : 23,
    hasTime ? Number(m[5]) : 59,
    hasTime ? Number(m[6]) : 59,
  );
}

const ORDINAL_BYDAY_RE = /^([+-]?\d+)(SU|MO|TU|WE|TH|FR|SA)$/i;

function parseByDay(raw: string): OrdinalDay[] {
  return raw.split(',').map((token) => {
    const t = token.trim().toUpperCase();
    if (BYDAY_TO_JS[t] !== undefined) {
      return { ordinal: null, weekday: BYDAY_TO_JS[t] };
    }
    const m = ORDINAL_BYDAY_RE.exec(t);
    if (m) {
      const ordinal = Number(m[1]);
      const dayCode = m[2] as string;
      if (ordinal === 0) throw new UnsupportedRRuleError(`BYDAY ordinal 0 is invalid: ${JSON.stringify(token)}`);
      return { ordinal, weekday: BYDAY_TO_JS[dayCode]! };
    }
    throw new UnsupportedRRuleError(`Unsupported BYDAY token: ${JSON.stringify(token)}`);
  });
}

/** Parse an RRULE string into a {@link ParsedRule}. Throws on unsupported rules. */
export function parseRRule(rule: string): ParsedRule {
  const parts: Record<string, string> = {};
  for (const segment of rule.trim().split(';')) {
    if (segment === '') continue;
    const eq = segment.indexOf('=');
    if (eq === -1) throw new UnsupportedRRuleError(`Malformed RRULE segment: ${JSON.stringify(segment)}`);
    parts[segment.slice(0, eq).toUpperCase()] = segment.slice(eq + 1);
  }

  const freq = (parts.FREQ ?? '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    throw new UnsupportedRRuleError(`FREQ=${parts.FREQ ?? '(missing)'} is not supported.`);
  }

  for (const unsupported of ['BYYEARDAY', 'BYWEEKNO']) {
    if (parts[unsupported] !== undefined) {
      throw new UnsupportedRRuleError(`${unsupported} is not supported.`);
    }
  }

  let interval = 1;
  if (parts.INTERVAL !== undefined) {
    interval = Number(parts.INTERVAL);
    if (!Number.isInteger(interval) || interval < 1) {
      throw new UnsupportedRRuleError(`Invalid INTERVAL: ${JSON.stringify(parts.INTERVAL)}`);
    }
  }

  const byday: OrdinalDay[] = parts.BYDAY !== undefined ? parseByDay(parts.BYDAY) : [];

  const bymonthday: number[] = [];
  if (parts.BYMONTHDAY !== undefined) {
    if (freq !== 'MONTHLY' && freq !== 'YEARLY') {
      throw new UnsupportedRRuleError('BYMONTHDAY is only valid with FREQ=MONTHLY or YEARLY.');
    }
    for (const token of parts.BYMONTHDAY.split(',')) {
      const n = Number(token.trim());
      if (!Number.isInteger(n) || n === 0 || n < -31 || n > 31) {
        throw new UnsupportedRRuleError(`Invalid BYMONTHDAY value: ${JSON.stringify(token)}`);
      }
      bymonthday.push(n);
    }
  }

  const bymonth: number[] = [];
  if (parts.BYMONTH !== undefined) {
    if (freq !== 'YEARLY') {
      throw new UnsupportedRRuleError('BYMONTH is only valid with FREQ=YEARLY.');
    }
    for (const token of parts.BYMONTH.split(',')) {
      const n = Number(token.trim());
      if (!Number.isInteger(n) || n < 1 || n > 12) {
        throw new UnsupportedRRuleError(`Invalid BYMONTH value: ${JSON.stringify(token)}`);
      }
      bymonth.push(n);
    }
  }

  const bysetpos: number[] = [];
  if (parts.BYSETPOS !== undefined) {
    for (const token of parts.BYSETPOS.split(',')) {
      const n = Number(token.trim());
      if (!Number.isInteger(n) || n === 0) {
        throw new UnsupportedRRuleError(`Invalid BYSETPOS value: ${JSON.stringify(token)}`);
      }
      bysetpos.push(n);
    }
  }

  let wkst = 1; // Monday default
  if (parts.WKST !== undefined) {
    const w = BYDAY_TO_JS[parts.WKST.toUpperCase()];
    if (w === undefined) throw new UnsupportedRRuleError(`Invalid WKST: ${JSON.stringify(parts.WKST)}`);
    wkst = w;
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
    freq: freq as ParsedRule['freq'],
    interval,
    byday,
    bymonthday,
    bymonth,
    bysetpos,
    wkst,
    count,
    untilMs: parts.UNTIL !== undefined ? parseUntil(parts.UNTIL) : null,
  };
}

// ---------------------------------------------------------------------------
// Civil-date helpers. Each candidate day is a UTC-midnight epoch-ms so
// day arithmetic is plain integer math, free of DST effects.
// ---------------------------------------------------------------------------

export const civilMidnightMs = (year: number, month: number, day: number): number =>
  Date.UTC(year, month - 1, day);

export const jsWeekday = (ms: number): number => new Date(ms).getUTCDay();

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Hard backstop so a malformed forever-rule can never loop unbounded. */
const MAX_OCCURRENCES = 10_000;

// ---------------------------------------------------------------------------
// BYSETPOS application
// ---------------------------------------------------------------------------

function applyBySetPos(candidates: number[], bysetpos: number[]): number[] {
  if (bysetpos.length === 0) return candidates;
  const sorted = [...candidates].sort((a, b) => a - b);
  const result: number[] = [];
  for (const pos of bysetpos) {
    const idx = pos > 0 ? pos - 1 : sorted.length + pos;
    if (idx >= 0 && idx < sorted.length) {
      const val = sorted[idx]!;
      if (!result.includes(val)) result.push(val);
    }
  }
  return result.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// MONTHLY expansion helpers
// ---------------------------------------------------------------------------

/**
 * Expand all candidate days in a given (year, month) per the rule's BYDAY and/or
 * BYMONTHDAY lists. Returns UTC-midnight epoch-ms values within that month.
 */
function expandMonthCandidates(year: number, month: number, rule: ParsedRule): number[] {
  const dim = daysInMonth(year, month);
  const candidates: number[] = [];

  if (rule.byday.length > 0 && rule.bymonthday.length === 0) {
    // BYDAY only. Ordinal-BYDAY: "2MO" = 2nd Monday; "-1FR" = last Friday.
    const hasOrdinals = rule.byday.some((b) => b.ordinal !== null);

    if (hasOrdinals) {
      for (const { ordinal, weekday } of rule.byday) {
        if (ordinal === null) {
          // Plain weekday — every occurrence in the month.
          for (let d = 1; d <= dim; d++) {
            if (jsWeekday(civilMidnightMs(year, month, d)) === weekday) {
              candidates.push(civilMidnightMs(year, month, d));
            }
          }
        } else {
          // Ordinal weekday.
          const matches: number[] = [];
          for (let d = 1; d <= dim; d++) {
            if (jsWeekday(civilMidnightMs(year, month, d)) === weekday) {
              matches.push(d);
            }
          }
          const idx = ordinal > 0 ? ordinal - 1 : matches.length + ordinal;
          if (idx >= 0 && idx < matches.length) {
            candidates.push(civilMidnightMs(year, month, matches[idx]!));
          }
        }
      }
    } else {
      // Plain BYDAY (every occurrence of those weekdays in the month).
      const weekdays = rule.byday.map((b) => b.weekday);
      for (let d = 1; d <= dim; d++) {
        if (weekdays.includes(jsWeekday(civilMidnightMs(year, month, d)))) {
          candidates.push(civilMidnightMs(year, month, d));
        }
      }
    }
  } else if (rule.bymonthday.length > 0 && rule.byday.length === 0) {
    // BYMONTHDAY only.
    for (const mday of rule.bymonthday) {
      const d = mday > 0 ? mday : dim + mday + 1;
      if (d >= 1 && d <= dim) candidates.push(civilMidnightMs(year, month, d));
    }
  } else if (rule.bymonthday.length > 0 && rule.byday.length > 0) {
    // Intersection: days that match BOTH BYMONTHDAY and BYDAY.
    const weekdays = rule.byday.map((b) => b.weekday);
    for (const mday of rule.bymonthday) {
      const d = mday > 0 ? mday : dim + mday + 1;
      if (d >= 1 && d <= dim && weekdays.includes(jsWeekday(civilMidnightMs(year, month, d)))) {
        candidates.push(civilMidnightMs(year, month, d));
      }
    }
  } else {
    // No BYDAY or BYMONTHDAY — use the same day-of-month as DTSTART.
    // (startDay is threaded via caller for MONTHLY; YEARLY will call with a fixed day.)
    // Caller is responsible for passing `startDay` via `rule`'s context; handled below.
  }

  return candidates.sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Yield occurrence calendar dates (as UTC-midnight epoch-ms) in chronological
 * order, from `startMs` up to and including `windowEndMs`.
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

  const emit = (ms: number): boolean => {
    if (!withinLimits(ms)) return false;
    emitted++;
    return true;
  };

  // -------------------------------------------------------------------------
  // DAILY
  // -------------------------------------------------------------------------
  if (rule.freq === 'DAILY') {
    for (let i = 0; i < MAX_OCCURRENCES; i++) {
      const ms = startMs + i * rule.interval * DAY_MS;
      if (!withinLimits(ms)) return;
      if (ms > windowEndMs) return;
      emit(ms);
      yield ms;
    }
    return;
  }

  // -------------------------------------------------------------------------
  // WEEKLY
  // -------------------------------------------------------------------------
  if (rule.freq === 'WEEKLY') {
    const bydays =
      rule.byday.length > 0
        ? rule.byday.map((b) => b.weekday)
        : [jsWeekday(startMs)];

    // Sort weekdays in Mon→Sun order starting from WKST.
    const sortedByDays = [...bydays].sort((a, b) => {
      const ra = (a - rule.wkst + 7) % 7;
      const rb = (b - rule.wkst + 7) % 7;
      return ra - rb;
    });

    const startDow = jsWeekday(startMs);
    const daysSinceWeekStart = (startDow - rule.wkst + 7) % 7;
    let weekStartMs = startMs - daysSinceWeekStart * DAY_MS;

    for (let week = 0; week < MAX_OCCURRENCES; week++) {
      if (week % rule.interval === 0) {
        for (const dow of sortedByDays) {
          const offset = (dow - rule.wkst + 7) % 7;
          const ms = weekStartMs + offset * DAY_MS;
          if (ms < startMs) continue;
          if (!withinLimits(ms)) return;
          if (ms > windowEndMs) return;
          emit(ms);
          yield ms;
        }
      }
      weekStartMs += 7 * DAY_MS;
      if (weekStartMs > windowEndMs) return;
    }
    return;
  }

  // -------------------------------------------------------------------------
  // MONTHLY
  // -------------------------------------------------------------------------
  if (rule.freq === 'MONTHLY') {
    const startDate = new Date(startMs);
    const startYear = startDate.getUTCFullYear();
    const startMonth = startDate.getUTCMonth() + 1;
    const startDay = startDate.getUTCDate();

    let year = startYear;
    let month = startMonth;

    for (let iter = 0; iter < MAX_OCCURRENCES; iter++) {
      const monthStartMs = civilMidnightMs(year, month, 1);
      if (monthStartMs > windowEndMs) return;

      let candidates: number[];
      if (rule.byday.length === 0 && rule.bymonthday.length === 0) {
        // Default: same day-of-month as DTSTART.
        const dim = daysInMonth(year, month);
        const d = Math.min(startDay, dim);
        candidates = [civilMidnightMs(year, month, d)];
      } else {
        candidates = expandMonthCandidates(year, month, rule);
      }

      candidates = applyBySetPos(candidates, rule.bysetpos);

      for (const ms of candidates) {
        if (ms < startMs) continue;
        if (!withinLimits(ms)) return;
        if (ms > windowEndMs) return;
        emit(ms);
        yield ms;
      }

      // Advance by INTERVAL months.
      month += rule.interval;
      while (month > 12) { month -= 12; year++; }
    }
    return;
  }

  // -------------------------------------------------------------------------
  // YEARLY
  // -------------------------------------------------------------------------
  if (rule.freq === 'YEARLY') {
    const startDate = new Date(startMs);
    const startYear = startDate.getUTCFullYear();
    const startMonth = startDate.getUTCMonth() + 1;
    const startDay = startDate.getUTCDate();

    for (let year = startYear; year < startYear + MAX_OCCURRENCES; year++) {
      if ((year - startYear) % rule.interval !== 0) continue;
      if (civilMidnightMs(year, 12, 31) < startMs) continue;
      if (civilMidnightMs(year, 1, 1) > windowEndMs) return;

      // Which months to expand? BYMONTH restricts; default = same month as start.
      const months = rule.bymonth.length > 0 ? rule.bymonth : [startMonth];

      for (const month of months) {
        let candidates: number[];
        if (rule.byday.length === 0 && rule.bymonthday.length === 0) {
          // Default: anniversary (same month + day as DTSTART, clamped to month length).
          const dim = daysInMonth(year, month);
          const d = Math.min(startDay, dim);
          candidates = [civilMidnightMs(year, month, d)];
        } else {
          candidates = expandMonthCandidates(year, month, rule);
        }

        candidates = applyBySetPos(candidates, rule.bysetpos);

        for (const ms of candidates) {
          if (ms < startMs) continue;
          if (!withinLimits(ms)) return;
          if (ms > windowEndMs) return;
          emit(ms);
          yield ms;
        }
      }
    }
    return;
  }
}

