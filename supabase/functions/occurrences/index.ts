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
  mapEventRow,
  MAX_RANGE_DAYS,
  RecurrenceRangeError,
  UnsupportedRRuleError,
  type EventRow,
} from '../_shared/recurrence/index.ts';
import {
  type OccurrenceModel,
  variablePlaceholder,
  variableWeeksInRange,
} from '../_shared/variable.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * The engine's `EventOccurrence` plus the variable-schedule marker.
 *
 * `isVariableSchedule` is part of the contract as of T9 — it is a required
 * property of `EventOccurrence` in `packages/api-contract/openapi.yaml`, so
 * this shape and the generated `@planpal/types` model agree. Keep it required:
 * the mobile calendar reads it to render the "schedule not yet entered" state,
 * and an optional field would make that a silent undefined.
 */
type OccurrenceResponseItem = OccurrenceModel;

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

  // No cast. This comment used to say `as unknown as` was "required, not
  // laziness" — true then, false now. Both halves that made it true have
  // landed: EVENT_COLUMNS is a single literal (C1), so supabase-js can infer
  // the row from the select string, and the schema is generated (T32), so the
  // inferred row is the real one. A cast here would go back to asserting the
  // shape instead of deriving it.
  const masters = mastersRes.data ?? [];
  const exceptions = exceptionsRes.data ?? [];
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

/**
 * Exactly the columns `mapEventRow` reads, plus `utc_start` for range-bounding.
 *
 * ONE single-quoted literal, deliberately. `supabase-js` parses the `.select()`
 * string at the type level, and TypeScript widens `'a' + 'b'` to `string` —
 * which degrades the row inference to `GenericStringError` and makes
 * `Property 'title' does not exist` the only thing the checker can say. Kept
 * literal, a misspelled column is a compile error instead (AD-11). Do not
 * break this line with `+`; let it exceed the line width.
 */
// deno-fmt-ignore
const EVENT_COLUMNS = 'id,owner_id,title,description,location,local_start,local_end,timezone_id,is_master,master_event_id,recurrence_exception_date,recurrence_rule,is_cancelled,is_variable_schedule,visibility,color_label,utc_start';

/**
 * One placeholder per week of the window for each variable-schedule master,
 * anchored on the master's own weekday.
 *
 * This pass and the engine partition the dates between them, and the split is
 * on whether the exception row carries concrete times — NOT on whether one
 * exists. A cancelled week is dropped; a week with real times belongs to the
 * engine and is skipped here; a week whose exception sets only descriptive
 * fields (a title, say) is still un-entered, so it stays a placeholder and
 * those fields are layered onto it. Keying on mere existence made a
 * title-only override disappear from the calendar, and letting the engine take
 * it invented a time from the master's placeholder hour.
 */
function variablePlaceholders(
  masters: EventRow[],
  exceptions: EventRow[],
  fromMs: number,
  toMs: number,
): OccurrenceResponseItem[] {
  const variable = masters.filter((m) => m.is_variable_schedule && m.local_start && m.timezone_id);
  if (variable.length === 0) return [];

  const byKey = new Map<string, EventRow>();
  for (const e of exceptions) {
    byKey.set(`${e.master_event_id}:${e.recurrence_exception_date}`, e);
  }

  const out: OccurrenceResponseItem[] = [];

  for (const master of variable) {
    for (const date of variableWeeksInRange(master, fromMs, toMs)) {
      const exception = byKey.get(`${master.id}:${date}`);
      // Cancelled: the week is gone. Concrete times: the engine emits it.
      if (exception?.is_cancelled) continue;
      if (exception?.local_start != null) continue;

      out.push(variablePlaceholder(master, date, exception ?? null));
    }
  }

  return out;
}
