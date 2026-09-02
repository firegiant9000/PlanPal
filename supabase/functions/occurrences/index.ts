/**
 * GET /occurrences — server-side recurrence expansion (M2).
 *
 * Query params:
 *   from  YYYY-MM-DD  (required, inclusive)
 *   to    YYYY-MM-DD  (required, inclusive, max 180 days from `from`)
 *
 * Returns ApiResult<{ items: EventOccurrence[] }> sorted by utcStart.
 * The client never expands RRULE — this endpoint does it server-side.
 *
 * Expansion is delegated to the ONE engine in `packages/recurrence`, mirrored
 * into `_shared/recurrence` by `pnpm recurrence:sync` (CI fails on drift). Do
 * not re-implement RRULE logic here — recurrence correctness is the project's
 * #1 risk and it only stays correct with a single tested implementation.
 */
import { getUserClient } from '../_shared/auth.ts';
import {
  badRequest,
  dbError,
  handleOptions,
  methodNotAllowed,
  ok,
  unauthenticated,
} from '../_shared/response.ts';
import {
  expandOccurrences,
  localToUtc,
  mapEventRow,
  MAX_RANGE_DAYS,
  parseLocal,
  RecurrenceRangeError,
  UnsupportedRRuleError,
  type EventRow,
} from '../_shared/recurrence/index.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * The engine's `EventOccurrence` plus the variable-schedule marker.
 *
 * NOTE (contract drift, needs both-dev sign-off before it is resolved):
 * `isVariableSchedule` is NOT in `packages/api-contract/openapi.yaml`'s
 * `EventOccurrence` schema, but the mobile calendar consumes it to render the
 * "Schedule not yet entered" state. Either add it to the spec and regenerate
 * types, or drop the placeholder from this response — do not leave it drifted.
 */
interface OccurrenceResponseItem {
  eventId: string;
  occurrenceDate: string;
  title: string;
  description?: string | null;
  location?: string | null;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  utcStart: string;
  utcEnd: string;
  visibility: string;
  colorLabel?: string | null;
  isException: boolean;
  isVariableSchedule: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET') return methodNotAllowed();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return badRequest('Query params "from" and "to" are required (YYYY-MM-DD).');
  }

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return badRequest('"from" and "to" must be real calendar dates.');
  }
  if (toMs < fromMs) return badRequest('"to" must be on or after "from".');

  // Inclusive day count, matching the engine's MAX_RANGE_DAYS semantics.
  const rangeDays = Math.floor((toMs - fromMs) / DAY_MS) + 1;
  if (rangeDays > MAX_RANGE_DAYS) {
    return badRequest(`Range exceeds the ${MAX_RANGE_DAYS}-day maximum (requested ${rangeDays}).`);
  }

  // Bound both reads instead of pulling the user's entire event history.
  //   - A master whose series starts after the window cannot contribute.
  //   - Only exception rows landing inside the window can override anything.
  const toExclusiveIso = new Date(toMs + DAY_MS).toISOString();

  const [mastersRes, exceptionsRes] = await Promise.all([
    client
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('owner_id', userId)
      .eq('is_master', true)
      .lt('utc_start', toExclusiveIso),
    client
      .from('events')
      .select(EVENT_COLUMNS)
      .eq('owner_id', userId)
      .eq('is_master', false)
      .gte('recurrence_exception_date', from)
      .lte('recurrence_exception_date', to),
  ]);

  if (mastersRes.error) return dbError(mastersRes.error, 'occurrences:masters');
  if (exceptionsRes.error) return dbError(exceptionsRes.error, 'occurrences:exceptions');

  // `as unknown as` is required, not laziness: supabase-js parses the select
  // string at the type level, and a runtime-built column list (EVENT_COLUMNS)
  // degrades its inference to `GenericStringError[]`. The real fix is generated
  // database types (`supabase gen types typescript`), which is an M3 task.
  const masters = (mastersRes.data ?? []) as unknown as EventRow[];
  const exceptions = (exceptionsRes.data ?? []) as unknown as EventRow[];
  const records = [...masters, ...exceptions].map(mapEventRow);

  let items: OccurrenceResponseItem[];
  try {
    items = expandOccurrences(records, { from, to }).map((o) => ({
      ...o,
      isVariableSchedule: false,
    }));
  } catch (error) {
    // A stored rule outside the supported subset is a client-visible data
    // problem, not a server fault — surface it instead of a 500.
    if (error instanceof UnsupportedRRuleError) {
      return badRequest(`Stored recurrence rule is not supported: ${error.message}`);
    }
    if (error instanceof RecurrenceRangeError) return badRequest(error.message);
    throw error;
  }

  // The engine deliberately skips variable-schedule masters (they have no
  // concrete rule yet). Surface them as weekly placeholders so the routine
  // stays visible on the calendar with a "Schedule not yet entered" state.
  items.push(...variablePlaceholders(masters, exceptions, fromMs, toMs));

  items.sort((a, b) => (a.utcStart < b.utcStart ? -1 : a.utcStart > b.utcStart ? 1 : 0));

  return ok({ items });
});

/** Exactly the columns `mapEventRow` reads, plus `utc_start` for range-bounding. */
const EVENT_COLUMNS =
  'id,owner_id,title,description,location,local_start,local_end,timezone_id,' +
  'is_master,master_event_id,recurrence_exception_date,recurrence_rule,' +
  'is_cancelled,is_variable_schedule,visibility,color_label,utc_start';

/**
 * One placeholder per week of the window for each variable-schedule master,
 * anchored on the master's own weekday. Weeks the user has already filled in
 * (an exception row exists for that date) are skipped, and cancelled weeks are
 * omitted entirely.
 */
function variablePlaceholders(
  masters: EventRow[],
  exceptions: EventRow[],
  fromMs: number,
  toMs: number,
): OccurrenceResponseItem[] {
  const variable = masters.filter((m) => m.is_variable_schedule && m.local_start && m.timezone_id);
  if (variable.length === 0) return [];

  const overridden = new Set(
    exceptions.map((e) => `${e.master_event_id}:${e.recurrence_exception_date}`),
  );

  const out: OccurrenceResponseItem[] = [];

  for (const master of variable) {
    const startCivil = parseLocal(master.local_start!);
    const anchorMs = Date.UTC(startCivil.year, startCivil.month - 1, startCivil.day);
    const anchorDow = new Date(anchorMs).getUTCDay();

    // First occurrence of the master's weekday on/after the window start.
    const fromDow = new Date(fromMs).getUTCDay();
    let cursor = fromMs + ((anchorDow - fromDow + 7) % 7) * DAY_MS;

    for (; cursor <= toMs; cursor += 7 * DAY_MS) {
      if (cursor < anchorMs) continue; // routine had not started yet
      const date = new Date(cursor).toISOString().slice(0, 10);
      if (overridden.has(`${master.id}:${date}`)) continue;

      const localStart = `${date}T${master.local_start!.slice(11, 19) || '00:00:00'}`;
      const localEnd = `${date}T${(master.local_end ?? master.local_start!).slice(11, 19) || '00:00:00'}`;
      const tz = master.timezone_id!;

      out.push({
        eventId: master.id,
        occurrenceDate: date,
        title: master.title ?? 'Variable schedule',
        description: master.description,
        location: master.location,
        localStart,
        localEnd,
        timezoneId: tz,
        utcStart: localToUtc(parseLocal(localStart), tz),
        utcEnd: localToUtc(parseLocal(localEnd), tz),
        visibility: master.visibility ?? 'private',
        colorLabel: master.color_label,
        isException: false,
        isVariableSchedule: true,
      });
    }
  }

  return out;
}
