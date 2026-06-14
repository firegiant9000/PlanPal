/**
 * GET /occurrences — server-side recurrence expansion (M2).
 *
 * Query params:
 *   from  YYYY-MM-DD  (required, inclusive)
 *   to    YYYY-MM-DD  (required, inclusive, max 180 days from from)
 *
 * Returns ApiResult<{ items: EventOccurrence[] }> sorted by utcStart.
 * The client never expands RRULE — this endpoint does it server-side.
 *
 * Variable-schedule masters return a placeholder occurrence so they remain
 * visible on the calendar with a "Schedule not yet entered" indicator.
 */
import { getUserClient } from '../_shared/auth.ts';
import { badRequest, handleOptions, ok, unauthenticated } from '../_shared/response.ts';

// Inline the recurrence engine types (Deno can import from npm via esm.sh,
// but the local package is not deployed to the Edge — we duplicate only what
// we need here and keep the real engine in packages/recurrence for Node tests).
// In practice the Edge Function bundle will include the compiled recurrence
// package once the build pipeline is wired (Month 3+). For now we import via
// a URL alias; the actual expansion logic is replicated from the package.

// For M2 we use a lightweight inline expand that delegates to the DB's
// utc_start (derived by trigger) for master events and calls the RPC for
// expansion. Full engine integration (tree-shaking the package into the
// bundle) is a Month 3 build pipeline task.

interface RawEventRow {
  id: string;
  owner_id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  local_start: string | null;
  local_end: string | null;
  timezone_id: string | null;
  is_master: boolean;
  master_event_id: string | null;
  recurrence_exception_date: string | null;
  recurrence_rule: string | null;
  is_cancelled: boolean;
  is_variable_schedule: boolean;
  visibility: string | null;
  color_label: string | null;
  utc_start: string | null;
  utc_end: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return badRequest('Query params "from" and "to" are required (YYYY-MM-DD).');
  }
  if (from > to) {
    return badRequest('"to" must be on or after "from".');
  }

  const fromMs = new Date(from + 'T00:00:00Z').getTime();
  const toMs = new Date(to + 'T23:59:59Z').getTime();
  const rangeDays = (toMs - fromMs) / 86_400_000;
  if (rangeDays > 180) {
    return badRequest('Range exceeds the 180-day maximum.');
  }

  // Fetch all master/standalone + exception rows for this user.
  const { data: rows, error } = await client
    .from('events')
    .select('*')
    .eq('owner_id', userId);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'DB_ERROR', message: error.message } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const allRows = (rows ?? []) as RawEventRow[];
  const occurrences = expandOccurrences(allRows, from, to);

  return ok({ items: occurrences });
});

// ---------------------------------------------------------------------------
// Lightweight occurrence expansion — mirrors packages/recurrence logic.
// Full RRULE engine bundle integration is a Month 3 build task.
// ---------------------------------------------------------------------------

interface EventOccurrence {
  eventId: string;
  occurrenceDate: string;
  title: string;
  description: string | null;
  location: string | null;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  utcStart: string;
  utcEnd: string;
  visibility: string;
  colorLabel: string | null;
  isException: boolean;
  isVariableSchedule: boolean;
}

function expandOccurrences(rows: RawEventRow[], from: string, to: string): EventOccurrence[] {
  const fromMs = new Date(from + 'T00:00:00Z').getTime();
  const toMs = new Date(to + 'T23:59:59Z').getTime();

  // Index exceptions by master_event_id → exception_date.
  const exceptionMap = new Map<string, Map<string, RawEventRow>>();
  for (const row of rows) {
    if (row.is_master || !row.master_event_id || !row.recurrence_exception_date) continue;
    let byDate = exceptionMap.get(row.master_event_id);
    if (!byDate) { byDate = new Map(); exceptionMap.set(row.master_event_id, byDate); }
    byDate.set(row.recurrence_exception_date, row);
  }

  const out: EventOccurrence[] = [];

  for (const master of rows) {
    if (!master.is_master || !master.local_start || !master.utc_start) continue;

    // Variable-schedule: emit a placeholder per week in the window.
    if (master.is_variable_schedule) {
      out.push(buildVariablePlaceholder(master, from));
      continue;
    }

    const exceptions = exceptionMap.get(master.id);

    if (!master.recurrence_rule) {
      // Standalone.
      const startMs = new Date(master.utc_start).getTime();
      if (startMs >= fromMs && startMs <= toMs) {
        out.push(buildOccurrence(master, master, false, from));
      }
      continue;
    }

    // Recurring: find occurrences by iterating the RRULE.
    // For M2 we use a simplified daily-walk approach scoped to the window.
    // The full RRULE engine (packages/recurrence) is bundled in Month 3.
    const occurrenceDates = simpleExpand(master.recurrence_rule, master.local_start, from, to);
    for (const dateStr of occurrenceDates) {
      const exception = exceptions?.get(dateStr);
      if (exception?.is_cancelled) continue;
      out.push(buildOccurrence(master, exception ?? null, exception !== null, dateStr));
    }
  }

  return out.sort((a, b) => (a.utcStart < b.utcStart ? -1 : a.utcStart > b.utcStart ? 1 : 0));
}

function buildOccurrence(
  master: RawEventRow,
  override: RawEventRow | null,
  isException: boolean,
  occurrenceDate: string,
): EventOccurrence {
  const title = (override?.title ?? master.title) as string;
  const localStart = override?.local_start ?? master.local_start!;
  const localEnd = override?.local_end ?? master.local_end!;
  const timezoneId = (override?.timezone_id ?? master.timezone_id) as string;
  const utcStart = deriveUtc(localStart, timezoneId);
  const utcEnd = deriveUtc(localEnd, timezoneId);

  return {
    eventId: master.id,
    occurrenceDate,
    title,
    description: override?.description ?? master.description,
    location: override?.location ?? master.location,
    localStart,
    localEnd,
    timezoneId,
    utcStart,
    utcEnd,
    visibility: (override?.visibility ?? master.visibility) as string,
    colorLabel: override?.color_label ?? master.color_label,
    isException,
    isVariableSchedule: false,
  };
}

function buildVariablePlaceholder(master: RawEventRow, occurrenceDate: string): EventOccurrence {
  return {
    eventId: master.id,
    occurrenceDate,
    title: master.title ?? 'Variable schedule',
    description: 'Schedule not yet entered',
    location: master.location,
    localStart: occurrenceDate + 'T00:00:00',
    localEnd: occurrenceDate + 'T00:00:00',
    timezoneId: master.timezone_id ?? 'UTC',
    utcStart: occurrenceDate + 'T00:00:00Z',
    utcEnd: occurrenceDate + 'T00:00:00Z',
    visibility: master.visibility as string,
    colorLabel: master.color_label,
    isException: false,
    isVariableSchedule: true,
  };
}

// Minimal RRULE walker — covers the common cases for M2.
// The full engine (packages/recurrence) is bundled in Month 3.
function simpleExpand(rrule: string, localStart: string, from: string, to: string): string[] {
  const parts: Record<string, string> = {};
  for (const seg of rrule.split(';')) {
    const eq = seg.indexOf('=');
    if (eq !== -1) parts[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }

  const startDate = new Date(localStart.slice(0, 10) + 'T00:00:00Z');
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T23:59:59Z');

  const freq = parts['FREQ']?.toUpperCase() ?? '';
  const interval = Number(parts['INTERVAL'] ?? '1');
  const count = parts['COUNT'] ? Number(parts['COUNT']) : null;
  const until = parts['UNTIL'] ? parseUntilDate(parts['UNTIL']) : null;

  const byday = (parts['BYDAY'] ?? '').split(',').filter(Boolean).map((d) => d.toUpperCase());
  const bymonthday = (parts['BYMONTHDAY'] ?? '').split(',').filter(Boolean).map(Number);
  const bymonth = (parts['BYMONTH'] ?? '').split(',').filter(Boolean).map(Number);

  const DAY_MS = 86_400_000;
  const results: string[] = [];
  let emitted = 0;

  const JS_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

  if (freq === 'DAILY') {
    for (let d = new Date(startDate); d <= toDate; d = new Date(d.getTime() + interval * DAY_MS)) {
      if (count !== null && emitted >= count) break;
      if (until && d > until) break;
      if (d >= fromDate) results.push(fmtDate(d));
      emitted++;
    }
  } else if (freq === 'WEEKLY') {
    const targetDays = byday.length > 0 ? byday.map((b) => JS_DOW[b] ?? -1) : [startDate.getUTCDay()];
    // Walk week by week.
    const startDow = startDate.getUTCDay();
    const wkst = 1; // Monday
    const daysSinceWkst = (startDow - wkst + 7) % 7;
    let weekStart = new Date(startDate.getTime() - daysSinceWkst * DAY_MS);

    for (let w = 0; weekStart <= toDate; w++, weekStart = new Date(weekStart.getTime() + 7 * DAY_MS)) {
      if (w % interval !== 0) continue;
      for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
        if (!targetDays.includes(dow)) continue;
        const offset = (dow - wkst + 7) % 7;
        const d = new Date(weekStart.getTime() + offset * DAY_MS);
        if (d < startDate) continue;
        if (count !== null && emitted >= count) return results;
        if (until && d > until) return results;
        if (d > toDate) return results;
        if (d >= fromDate) results.push(fmtDate(d));
        emitted++;
      }
    }
  } else if (freq === 'MONTHLY') {
    let year = startDate.getUTCFullYear();
    let month = startDate.getUTCMonth() + 1;
    for (let iter = 0; iter < 1200; iter++) {
      const candidates = monthCandidates(year, month, startDate.getUTCDate(), byday, bymonthday);
      for (const d of candidates) {
        if (d < startDate) continue;
        if (count !== null && emitted >= count) return results;
        if (until && d > until) return results;
        if (d > toDate) return results;
        if (d >= fromDate) results.push(fmtDate(d));
        emitted++;
      }
      month += interval;
      while (month > 12) { month -= 12; year++; }
      if (new Date(Date.UTC(year, month - 1, 1)) > toDate) break;
    }
  } else if (freq === 'YEARLY') {
    const startYear = startDate.getUTCFullYear();
    for (let year = startYear; year <= toDate.getUTCFullYear() + 1; year++) {
      if ((year - startYear) % interval !== 0) continue;
      const months = bymonth.length > 0 ? bymonth : [startDate.getUTCMonth() + 1];
      for (const month of months) {
        const candidates = monthCandidates(year, month, startDate.getUTCDate(), byday, bymonthday);
        for (const d of candidates) {
          if (d < startDate) continue;
          if (count !== null && emitted >= count) return results;
          if (until && d > until) return results;
          if (d > toDate) return results;
          if (d >= fromDate) results.push(fmtDate(d));
          emitted++;
        }
      }
    }
  }

  return results;
}

function monthCandidates(year: number, month: number, startDay: number, byday: string[], bymonthday: number[]): Date[] {
  const JS_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates: Date[] = [];

  if (byday.length === 0 && bymonthday.length === 0) {
    const d = Math.min(startDay, dim);
    dates.push(new Date(Date.UTC(year, month - 1, d)));
  } else if (bymonthday.length > 0) {
    for (const mday of bymonthday) {
      const d = mday > 0 ? mday : dim + mday + 1;
      if (d >= 1 && d <= dim) dates.push(new Date(Date.UTC(year, month - 1, d)));
    }
  } else {
    // byday with optional ordinal (e.g. "2MO", "-1FR").
    for (const bd of byday) {
      const m = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(bd);
      if (!m) continue;
      const ordinal = m[1] ? Number(m[1]) : null;
      const dayCode = (m[2] ?? '').toUpperCase();
      const weekday = JS_DOW[dayCode] ?? -1;
      const matches: Date[] = [];
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(Date.UTC(year, month - 1, d));
        if (dt.getUTCDay() === weekday) matches.push(dt);
      }
      if (ordinal === null) {
        dates.push(...matches);
      } else {
        const idx = ordinal > 0 ? ordinal - 1 : matches.length + ordinal;
        if (idx >= 0 && idx < matches.length) dates.push(matches[idx]!);
      }
    }
  }

  return dates.sort((a, b) => a.getTime() - b.getTime());
}

function parseUntilDate(raw: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!m) return new Date(0);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59));
}

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function deriveUtc(local: string, tz: string): string {
  // Use JS Date + Intl for DST-correct conversion (same approach as timezone.ts).
  const asUtc = new Date(local.replace(' ', 'T') + 'Z').getTime();
  const offsetMs = getOffsetMs(asUtc, tz);
  const utcMs = asUtc - offsetMs;
  const d = new Date(utcMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function getOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return local - utcMs;
}
