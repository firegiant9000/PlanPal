/**
 * `expandOccurrences` — the Phase 4 kickoff entry point.
 *
 * Expands a caller's `EventRecord[]` (masters/standalone + sparse exception rows)
 * into concrete {@link EventOccurrence}s within an inclusive `[from, to]` window,
 * applying THIS-scope overrides and cancellations. Pure and synchronous: it does no
 * I/O. The future `GET /occurrences` endpoint fetches the owner's rows, maps them
 * with `mapEventRow`, and calls this.
 */
import type { EventOccurrence } from '@planpal/types';
import { type DateRange, type EventRecord, MAX_RANGE_DAYS, RecurrenceRangeError } from './types.js';
import { type Civil, formatLocal, localToUtc, parseLocal } from './timezone.js';
import { DAY_MS, civilMidnightMs, occurrenceDates, parseRRule } from './rrule.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number): string => String(n).padStart(2, '0');

function parseDateOnly(value: string, field: string): number {
  const m = DATE_RE.exec(value);
  if (!m) {
    throw new RecurrenceRangeError(`Invalid ${field} date (expected YYYY-MM-DD): ${JSON.stringify(value)}`);
  }
  return civilMidnightMs(Number(m[1]), Number(m[2]), Number(m[3]));
}

const formatDateOnly = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** Full naive-civil instant of a `Civil` as epoch-ms (treating wall clock as UTC). */
const civilFullMs = (c: Civil): number =>
  Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);

const civilFromMs = (ms: number): Civil => {
  const d = new Date(ms);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
};

/** Validate the window and return its inclusive `[from, to]` midnights in epoch-ms. */
function resolveRange(range: DateRange): { fromMs: number; toMs: number } {
  const fromMs = parseDateOnly(range.from, 'from');
  const toMs = parseDateOnly(range.to, 'to');
  if (toMs < fromMs) {
    throw new RecurrenceRangeError(`Range "to" (${range.to}) is before "from" (${range.from}).`);
  }
  if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) {
    throw new RecurrenceRangeError(`Range exceeds the ${MAX_RANGE_DAYS}-day maximum.`);
  }
  return { fromMs, toMs };
}

/**
 * Build the single output occurrence for one series date, layering a sparse
 * exception (override) over the master. `null` fields on an override mean
 * "inherit from the master" (matches the schema's sparse-exception semantics).
 */
function buildOccurrence(
  master: EventRecord,
  occurrenceDateMs: number,
  override: EventRecord | null,
): EventOccurrence {
  // Master timing is guaranteed present by the schema's events_master_fields_ck.
  const masterStart = parseLocal(master.localStart as string);
  const masterEnd = parseLocal(master.localEnd as string);
  const durationMs = civilFullMs(masterEnd) - civilFullMs(masterStart);

  // Default: master time-of-day projected onto the occurrence date.
  const timeOfDayMs = (masterStart.hour * 3600 + masterStart.minute * 60 + masterStart.second) * 1000;
  let startFullMs = occurrenceDateMs + timeOfDayMs;
  let endFullMs = startFullMs + durationMs;

  // Overrides replace timing absolutely when provided.
  if (override?.localStart != null) {
    startFullMs = civilFullMs(parseLocal(override.localStart));
    endFullMs = startFullMs + durationMs;
  }
  if (override?.localEnd != null) {
    endFullMs = civilFullMs(parseLocal(override.localEnd));
  }

  const startCivil = civilFromMs(startFullMs);
  const endCivil = civilFromMs(endFullMs);
  const timezoneId = (override?.timezoneId ?? master.timezoneId) as string;

  return {
    eventId: master.id,
    occurrenceDate: formatDateOnly(occurrenceDateMs),
    title: (override?.title ?? master.title) as string,
    description: override?.description ?? master.description,
    location: override?.location ?? master.location,
    localStart: formatLocal(startCivil),
    localEnd: formatLocal(endCivil),
    timezoneId,
    utcStart: localToUtc(startCivil, timezoneId),
    utcEnd: localToUtc(endCivil, timezoneId),
    visibility: (override?.visibility ?? master.visibility) as EventOccurrence['visibility'],
    colorLabel: override?.colorLabel ?? master.colorLabel,
    isException: override !== null,
  } as EventOccurrence;
}

/**
 * Expand `records` into concrete occurrences within the inclusive `[from, to]`
 * window. Throws {@link RecurrenceRangeError} on a bad/oversized range and
 * `UnsupportedRRuleError` on an out-of-subset RRULE (see `rrule.ts`).
 *
 * Variable-schedule masters are intentionally NOT expanded — they have no concrete
 * schedule until one is entered (M2 "schedule not yet entered" behavior).
 */
export function expandOccurrences(records: readonly EventRecord[], range: DateRange): EventOccurrence[] {
  const { fromMs, toMs } = resolveRange(range);

  // Index exception rows by their master, then by overridden date.
  const exceptionsByMaster = new Map<string, Map<string, EventRecord>>();
  for (const rec of records) {
    if (rec.isMaster || rec.masterEventId == null || rec.recurrenceExceptionDate == null) continue;
    let byDate = exceptionsByMaster.get(rec.masterEventId);
    if (byDate === undefined) {
      byDate = new Map<string, EventRecord>();
      exceptionsByMaster.set(rec.masterEventId, byDate);
    }
    byDate.set(rec.recurrenceExceptionDate, rec);
  }

  const out: EventOccurrence[] = [];

  for (const rec of records) {
    if (!rec.isMaster) continue; // exception rows are applied via their master
    if (rec.isVariableSchedule) continue; // no concrete schedule yet (M2)
    if (rec.localStart == null) continue; // defensive: a master without timing

    const startCivil = parseLocal(rec.localStart);
    const seriesStartMs = civilMidnightMs(startCivil.year, startCivil.month, startCivil.day);
    const exceptions = exceptionsByMaster.get(rec.id);

    if (rec.recurrenceRule == null) {
      // Standalone event — a single occurrence on its own date.
      if (seriesStartMs >= fromMs && seriesStartMs <= toMs) {
        out.push(buildOccurrence(rec, seriesStartMs, null));
      }
      continue;
    }

    const rule = parseRRule(rec.recurrenceRule);
    for (const occMs of occurrenceDates(rule, seriesStartMs, toMs)) {
      if (occMs < fromMs) continue; // before the window, but still counted by the rule
      const dateStr = formatDateOnly(occMs);
      const exception = exceptions?.get(dateStr);
      if (exception?.isCancelled) continue; // THIS-cancel removes this occurrence
      out.push(buildOccurrence(rec, occMs, exception ?? null));
    }
  }

  out.sort((a, b) => (a.utcStart < b.utcStart ? -1 : a.utcStart > b.utcStart ? 1 : 0));
  return out;
}
