/**
 * iCalendar (RFC 5545) serialisation — M3 scope.
 *
 * Kept pure and separate from the handler so it can be exercised directly. The
 * fiddly parts of this format are not the structure, they are the details that
 * make an importer reject the whole file: CRLF line endings, folding at 75
 * octets, TEXT escaping, and getting TZID onto every local timestamp.
 *
 * M3 scope per §6: one VEVENT per master with its RRULE passed through, EXDATE
 * for cancelled occurrences, and a separate VEVENT carrying RECURRENCE-ID for
 * each override. Non-private events only. Standards hardening is M9.
 */

export interface IcalEventRow {
  id: string;
  title: string | null;
  description: string | null;
  location: string | null;
  local_start: string | null;
  local_end: string | null;
  timezone_id: string | null;
  recurrence_rule: string | null;
  visibility: string | null;
  created_at: string;
  updated_at: string;
}

export interface IcalExceptionRow {
  master_event_id: string;
  recurrence_exception_date: string;
  is_cancelled: boolean;
  title: string | null;
  description: string | null;
  location: string | null;
  local_start: string | null;
  local_end: string | null;
  timezone_id: string | null;
  /** null = inherit the master's visibility. `private` is never exported. */
  visibility: string | null;
}

/** RFC 5545 §3.3.11 — escape TEXT values. Colons are NOT escaped. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * RFC 5545 §3.1 — fold content lines at 75 octets.
 *
 * Octets, not characters: a non-ASCII title would otherwise fold mid-codepoint
 * and corrupt the output. Folds are measured on the UTF-8 encoding and never
 * split a multi-byte sequence.
 */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;

  const decoder = new TextDecoder();
  const parts: string[] = [];
  let start = 0;
  // First line takes 75 octets; continuations take 74, since each is prefixed
  // with a single space that counts toward the limit.
  let limit = 75;

  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Do not split a UTF-8 continuation byte (0b10xxxxxx) from its leader.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
    parts.push(decoder.decode(bytes.slice(start, end)));
    start = end;
    limit = 74;
  }

  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => `\r\n ${p}`)
      .join('')
  );
}

/** `2026-09-07T09:00:00` -> `20260907T090000`. */
export function toIcalLocal(localDateTime: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(localDateTime);
  if (!match) throw new Error(`Unparseable local datetime: ${localDateTime}`);
  const [, y, mo, d, h, mi, s] = match;
  return `${y}${mo}${d}T${h}${mi}${s ?? '00'}`;
}

/** `2026-09-07` + a time-of-day source -> `20260907T090000`. */
export function toIcalLocalOnDate(date: string, timeSource: string): string {
  const time = toIcalLocal(timeSource).slice(9); // HHMMSS
  return `${date.replace(/-/g, '')}T${time}`;
}

/**
 * Parse a naive local datetime to epoch-ms, treating the wall clock as UTC.
 *
 * Only ever used for arithmetic between two wall-clock values in the same zone
 * (an override's start and the master's duration), so no zone conversion is
 * involved and none must be inferred from the result.
 */
function naiveMs(localDateTime: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(localDateTime);
  if (!m) throw new Error(`Unparseable local datetime: ${localDateTime}`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, m[6] ? +m[6]! : 0);
}

/** A calendar date plus a time-of-day source -> naive epoch-ms. */
function onDateMs(date: string, timeSource: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!d) throw new Error(`Unparseable date: ${date}`);
  const t = /[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(timeSource);
  return Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, t ? +t[1]! : 0, t ? +t[2]! : 0, t?.[3] ? +t[3]! : 0);
}

/** Naive epoch-ms -> `20260907T090000`. */
function fromNaiveMs(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

/** An ISO instant -> `20260907T130000Z`. */
export function toIcalUtc(iso: string): string {
  return new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function push(lines: string[], name: string, value: string) {
  lines.push(foldLine(`${name}:${value}`));
}

/**
 * Build the .ics document.
 *
 * `exceptions` are grouped by master by the caller's query; cancelled rows
 * become EXDATE entries on the master, overrides become their own VEVENT.
 */
export function buildIcal(
  events: IcalEventRow[],
  exceptions: IcalExceptionRow[],
  opts: { prodId?: string } = {},
): string {
  const lines: string[] = [];
  const stamp = toIcalUtc(new Date().toISOString());

  lines.push('BEGIN:VCALENDAR');
  push(lines, 'PRODID', opts.prodId ?? '-//PlanPal//PlanPal Calendar//EN');
  push(lines, 'VERSION', '2.0');
  push(lines, 'CALSCALE', 'GREGORIAN');
  push(lines, 'METHOD', 'PUBLISH');

  const byMaster = new Map<string, IcalExceptionRow[]>();
  for (const ex of exceptions) {
    const list = byMaster.get(ex.master_event_id) ?? [];
    list.push(ex);
    byMaster.set(ex.master_event_id, list);
  }

  for (const event of events) {
    // events_master_fields_ck guarantees these on a master, but the column
    // types are nullable, so skip rather than emit a malformed VEVENT that
    // would make an importer reject the entire file.
    if (!event.local_start || !event.local_end || !event.timezone_id || !event.title) continue;

    const tz = event.timezone_id;
    const uid = `${event.id}@planpal.app`;
    const related = byMaster.get(event.id) ?? [];

    lines.push('BEGIN:VEVENT');
    push(lines, 'UID', uid);
    push(lines, 'DTSTAMP', stamp);
    push(lines, `DTSTART;TZID=${tz}`, toIcalLocal(event.local_start));
    push(lines, `DTEND;TZID=${tz}`, toIcalLocal(event.local_end));
    push(lines, 'SUMMARY', escapeText(event.title));
    if (event.description) push(lines, 'DESCRIPTION', escapeText(event.description));
    if (event.location) push(lines, 'LOCATION', escapeText(event.location));
    if (event.recurrence_rule) push(lines, 'RRULE', event.recurrence_rule);
    push(lines, 'CREATED', toIcalUtc(event.created_at));
    push(lines, 'LAST-MODIFIED', toIcalUtc(event.updated_at));

    // An occurrence leaves the exported series entirely if it was cancelled OR
    // if it was overridden to `private`. The second case is not cosmetic: the
    // exception row carries its own title/description/location, and emitting
    // its VEVENT would publish detail the user marked private on a master that
    // is merely shared. Dropping it from the series is the honest export —
    // suppressing only the VEVENT would leave the importer expanding the
    // master's own instance in its place.
    const removed = related.filter((r) => r.is_cancelled || r.visibility === 'private');
    if (removed.length > 0) {
      // EXDATE must carry the same TZID and time-of-day as DTSTART, or the
      // importer cannot match it to an instance and the removal is lost.
      const values = removed
        .map((r) => toIcalLocalOnDate(r.recurrence_exception_date, event.local_start!))
        .join(',');
      push(lines, `EXDATE;TZID=${tz}`, values);
    }

    lines.push('END:VEVENT');

    // Overrides are separate VEVENTs sharing the master's UID, identified by
    // the occurrence they replace.
    const masterDurationMs = naiveMs(event.local_end) - naiveMs(event.local_start);

    for (const ov of related.filter((r) => !r.is_cancelled && r.visibility !== 'private')) {
      // A sparse override may set only one side of the window. The missing
      // side is derived by preserving the MASTER'S DURATION, matching the
      // engine's rule in packages/recurrence/src/expand.ts#buildOccurrence.
      // Falling back to the master's end time-of-day instead (the previous
      // behaviour) produced DTEND before DTSTART whenever an occurrence was
      // moved later in the day — a negative-duration VEVENT that importers
      // reject, taking the rest of the file with it.
      const seriesStartMs = onDateMs(ov.recurrence_exception_date, event.local_start);
      const startMs = ov.local_start ? naiveMs(ov.local_start) : seriesStartMs;
      const endMs = ov.local_end ? naiveMs(ov.local_end) : startMs + masterDurationMs;

      // Defensive: the API rejects an override whose merged window is inverted,
      // so this is unreachable through it. A row that predates that validation
      // is skipped rather than written out as a malformed VEVENT.
      if (endMs <= startMs) continue;

      const ovTz = ov.timezone_id ?? tz;

      lines.push('BEGIN:VEVENT');
      push(lines, 'UID', uid);
      push(lines, 'DTSTAMP', stamp);
      // RECURRENCE-ID is the ORIGINAL occurrence's start, in the master's zone
      // and time-of-day — not the overridden one. Using the new time would
      // leave the importer unable to tell which instance is being replaced.
      push(
        lines,
        `RECURRENCE-ID;TZID=${tz}`,
        toIcalLocalOnDate(ov.recurrence_exception_date, event.local_start),
      );
      push(lines, `DTSTART;TZID=${ovTz}`, fromNaiveMs(startMs));
      push(lines, `DTEND;TZID=${ovTz}`, fromNaiveMs(endMs));
      push(lines, 'SUMMARY', escapeText(ov.title ?? event.title));
      const desc = ov.description ?? event.description;
      if (desc) push(lines, 'DESCRIPTION', escapeText(desc));
      const loc = ov.location ?? event.location;
      if (loc) push(lines, 'LOCATION', escapeText(loc));
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');

  // RFC 5545 §3.1: lines are delimited by CRLF, and the file ends with one.
  return lines.join('\r\n') + '\r\n';
}
