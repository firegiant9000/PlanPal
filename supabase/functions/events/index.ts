/**
 * /events — master event CRUD (M2).
 *
 * Routes:
 *   GET    /events                             list master events (paginated)
 *   POST   /events                             create a master/standalone event
 *   GET    /events/:id                         get one event
 *   PATCH  /events/:id                         update master (ALL scope)
 *   DELETE /events/:id                         delete master + all exceptions
 *   PATCH  /events/:id/occurrences/:date       THIS-override an occurrence
 *   DELETE /events/:id/occurrences/:date       THIS-cancel an occurrence
 *
 * The override route is PATCH returning EventOccurrenceResult, per the
 * contract. It previously answered PUT and returned the raw exception row in
 * the Event shape — which cannot represent a sparse exception without emitting
 * null for six required non-nullable fields.
 */
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserClient } from '../_shared/auth.ts';
import { readJsonObject } from '../_shared/body.ts';
import {
  badRequest,
  dbError,
  handleOptions,
  methodNotAllowed,
  notFound,
  ok,
  unauthenticated,
} from '../_shared/response.ts';
import {
  expandOccurrences,
  mapEventRow,
  parseRRule,
  UnsupportedRRuleError,
  type EventRow,
} from '../_shared/recurrence/index.ts';
import { type EventRowFull, toEventModel, toEventModels } from '../_shared/serialize.ts';
import {
  isCalendarDate,
  LOCAL_DT_RE,
  validateTimezone,
  VISIBILITIES,
} from '../_shared/validate.ts';
import {
  isVariableWeek,
  variablePlaceholder,
  type VariableExceptionRow,
  type VariableMasterRow,
} from '../_shared/variable.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const url = new URL(req.url);
  // Path: /events, /events/:id, /events/:id/occurrences/:date
  const segments = url.pathname.replace(/^\/+/, '').split('/');
  // segments[0] = "events", [1] = eventId?, [2] = "occurrences"?, [3] = date?
  const eventId = segments[1] ?? null;
  const isOccurrencePath = segments[2] === 'occurrences';
  const occurrenceDate = isOccurrencePath ? (segments[3] ?? null) : null;

  // --- Collection ---
  if (!eventId) {
    if (req.method === 'GET') return listEvents(client, userId, url);
    if (req.method === 'POST') return createEvent(client, userId, req);
    return methodNotAllowed();
  }

  if (!UUID_RE.test(eventId)) return notFound('Event');

  // --- Occurrence sub-resource ---
  // Never fall through: `/events/:id/occurrences` with a missing or malformed
  // date previously dropped into the single-event branch, where a DELETE that
  // meant "cancel one day" deleted the entire master and its exceptions.
  if (isOccurrencePath) {
    if (!occurrenceDate || !isCalendarDate(occurrenceDate)) {
      return badRequest('Occurrence date must be a real calendar date (YYYY-MM-DD).');
    }
    if (req.method === 'PATCH')
      return overrideOccurrence(client, userId, eventId, occurrenceDate, req);
    if (req.method === 'DELETE') return cancelOccurrence(client, userId, eventId, occurrenceDate);
    return methodNotAllowed();
  }

  // --- Single event ---
  if (req.method === 'GET') return getEvent(client, userId, eventId);
  if (req.method === 'PATCH') return updateEvent(client, userId, eventId, req);
  if (req.method === 'DELETE') return deleteEvent(client, userId, eventId);
  return methodNotAllowed();
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listEvents(client: SupabaseClient, userId: string, url: URL) {
  const rawLimit = Number(url.searchParams.get('limit') ?? '50');
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    return badRequest('"limit" must be a positive integer.');
  }
  const limit = Math.min(rawLimit, 100);
  const cursor = url.searchParams.get('cursor');

  let query = client
    .from('events')
    .select('*')
    .eq('owner_id', userId)
    .eq('is_master', true)
    // Keyset pagination requires the sort key and the cursor to be the same
    // column, and that column to be unique. `id` is the primary key; ordering
    // by created_at while seeking on id (the previous behaviour) silently
    // skipped and repeated rows.
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (cursor) {
    if (!UUID_RE.test(cursor)) return badRequest('"cursor" must be a valid event id.');
    query = query.gt('id', cursor);
  }

  const { data, error } = await query;
  if (error) return dbError(error, 'events:list');

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

  // Widening cast per AD-11; removed by T32.
  return ok({ items: toEventModels(page as unknown as EventRowFull[]), nextCursor });
}

async function createEvent(client: SupabaseClient, userId: string, req: Request) {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const validation = validateEventWrite(body);
  if (validation) return badRequest(validation);

  const row = {
    owner_id: userId,
    title: body.title as string,
    description: (body.description as string | null) ?? null,
    location: (body.location as string | null) ?? null,
    local_start: body.localStart as string,
    local_end: body.localEnd as string,
    timezone_id: body.timezoneId as string,
    is_master: true,
    recurrence_rule: (body.recurrenceRule as string | null) ?? null,
    is_variable_schedule: (body.isVariableSchedule as boolean | null) ?? false,
    visibility: body.visibility as string,
    color_label: (body.colorLabel as string | null) ?? null,
    shared_with: (body.sharedWith as string[] | null) ?? [],
  };

  const { data, error } = await client.from('events').insert(row).select().single();
  if (error) return dbError(error, 'events:create');
  // Widening cast: supabase-js degrades `.select()` inference to
  // GenericStringError when the column list is not a literal. Removed by T32
  // (generated database types) — see AD-11.
  return ok(toEventModel(data as unknown as EventRowFull), 201);
}

async function getEvent(client: SupabaseClient, userId: string, eventId: string) {
  const { data, error } = await client
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (error) return dbError(error, 'events:get');
  if (!data) return notFound('Event');
  // Widening cast per AD-11; removed by T32.
  return ok(toEventModel(data as unknown as EventRowFull));
}

async function updateEvent(client: SupabaseClient, userId: string, eventId: string, req: Request) {
  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const allowed: Record<string, string> = {
    title: 'title',
    description: 'description',
    location: 'location',
    localStart: 'local_start',
    localEnd: 'local_end',
    timezoneId: 'timezone_id',
    recurrenceRule: 'recurrence_rule',
    isVariableSchedule: 'is_variable_schedule',
    visibility: 'visibility',
    colorLabel: 'color_label',
    sharedWith: 'shared_with',
  };

  const patch: Record<string, unknown> = {};
  for (const [clientKey, dbKey] of Object.entries(allowed)) {
    if (Object.hasOwn(body, clientKey)) patch[dbKey] = body[clientKey];
  }

  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided.');

  const validation = validateEventPatch(body);
  if (validation) return badRequest(validation);

  const { data, error } = await client
    .from('events')
    .update(patch)
    .eq('id', eventId)
    .eq('owner_id', userId)
    .select()
    .maybeSingle();
  if (error) return dbError(error, 'events:update');
  if (!data) return notFound('Event');
  // Widening cast per AD-11; removed by T32.
  return ok(toEventModel(data as unknown as EventRowFull));
}

async function deleteEvent(client: SupabaseClient, userId: string, eventId: string) {
  // `select()` so a delete that matched nothing is reported as 404 rather than
  // a misleading success.
  const { data, error } = await client
    .from('events')
    .delete()
    .eq('id', eventId)
    .eq('owner_id', userId)
    .select('id');
  if (error) return dbError(error, 'events:delete');
  if (!data || data.length === 0) return notFound('Event');
  // 202 with a null payload — EmptyResult, per the contract.
  return ok(null, 202);
}

/** The OccurrenceOverride fields the contract declares, mapped to columns. */
const OVERRIDE_FIELDS: Record<string, string> = {
  title: 'title',
  description: 'description',
  location: 'location',
  localStart: 'local_start',
  localEnd: 'local_end',
  visibility: 'visibility',
  colorLabel: 'color_label',
};

async function overrideOccurrence(
  client: SupabaseClient,
  userId: string,
  eventId: string,
  date: string,
  req: Request,
) {
  // The full master row: needed both for ownership and to resolve the merged
  // occurrence the contract says this route returns.
  const { data: master, error: masterErr } = await client
    .from('events')
    .select('*')
    .eq('id', eventId)
    .eq('owner_id', userId)
    .eq('is_master', true)
    .maybeSingle();
  if (masterErr) return dbError(masterErr, 'events:override:master');
  if (!master) return notFound('Event');

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;

  const validation = validateOccurrenceOverride(body);
  if (validation) return badRequest(validation);

  // Build the jsonb patch of only the keys the request actually named. The
  // three states matter: absent means "keep", present-and-null means "clear".
  const patch: Record<string, unknown> = {};
  for (const clientKey of Object.keys(OVERRIDE_FIELDS)) {
    if (Object.hasOwn(body, clientKey)) patch[clientKey] = body[clientKey];
  }

  // Reject writes the series cannot represent BEFORE persisting: a date the
  // rule never generates is a 404, and a merged window that ends on or before
  // it starts is a 400 (each field can be valid alone — a localEnd-only
  // override landing behind the master's projected start, say). This needs the
  // pre-write state, so it reads the current exception row; unlike the write
  // itself, a stale read here only risks accepting a write that a concurrent
  // edit has just made valid or invalid, not silently discarding a field.
  const { data: existing, error: existingErr } = await client
    .from('events')
    .select('*')
    .eq('master_event_id', eventId)
    .eq('recurrence_exception_date', date)
    .maybeSingle();
  if (existingErr) return dbError(existingErr, 'events:override:existing');

  const candidate: Record<string, unknown> = {
    ...(existing ?? {}),
    id: existing?.id ?? '00000000-0000-0000-0000-000000000000',
    owner_id: userId,
    master_event_id: eventId,
    recurrence_exception_date: date,
    is_master: false,
    is_cancelled: false,
    recurrence_rule: null,
    is_variable_schedule: false,
  };
  for (const [clientKey, dbKey] of Object.entries(OVERRIDE_FIELDS)) {
    if (Object.hasOwn(body, clientKey)) candidate[dbKey] = body[clientKey];
  }

  const masterRecord = mapEventRow(master as unknown as EventRow);
  const isVariable = master.is_variable_schedule === true;

  // A variable master has no rule for the engine to expand, so its valid dates
  // are the weeks /occurrences synthesises placeholders for — one predicate,
  // shared, rather than each route deciding for itself.
  if (isVariable && !isVariableWeek(master as unknown as VariableMasterRow, date)) {
    return notFound('Occurrence');
  }

  let resolved;
  try {
    resolved = expandOccurrences([masterRecord, mapEventRow(candidate as unknown as EventRow)], {
      from: date,
      to: date,
    }).find((o) => o.occurrenceDate === date);
  } catch (error) {
    if (error instanceof UnsupportedRRuleError) {
      return badRequest(`Stored recurrence rule is not supported: ${error.message}`);
    }
    throw error;
  }
  // On a variable master the engine emits nothing until the week has concrete
  // times, so an absent result there means "still un-entered", not "no such
  // occurrence" — the date was already validated above.
  if (!resolved && !isVariable) return notFound('Occurrence');
  if (resolved && resolved.localEnd <= resolved.localStart) {
    return badRequest('The overridden occurrence would end on or before it starts.');
  }

  // The write is a single INSERT ... ON CONFLICT DO UPDATE inside the database,
  // so the merge is evaluated against the live row. Doing it here as
  // read-then-upsert lost concurrent edits ~42% of the time — see
  // 20260904000001.
  const { data: written, error } = await client
    .rpc('override_occurrence', { p_master_id: eventId, p_date: date, p_patch: patch })
    .maybeSingle();
  if (error) return dbError(error, 'events:override');
  if (!written) return notFound('Event');

  // Re-resolve from what was actually persisted rather than from the candidate,
  // so the response reflects the merge the database performed — including any
  // field a concurrent PATCH set.
  const finalRecord = mapEventRow(written as unknown as EventRow);
  const final = expandOccurrences([masterRecord, finalRecord], { from: date, to: date }).find(
    (o) => o.occurrenceDate === date,
  );

  // EventOccurrenceResult, per the contract.
  if (final) {
    // Concrete times, so this is no longer a placeholder even on a variable
    // master — matching what /occurrences serves for the date after the write.
    return ok({ ...final, isVariableSchedule: false });
  }

  // Variable master, week still un-entered: return the placeholder the
  // calendar will show, so the client sees the same object either way.
  return ok(
    variablePlaceholder(
      master as unknown as VariableMasterRow,
      date,
      written as unknown as VariableExceptionRow,
    ),
  );
}

async function cancelOccurrence(
  client: SupabaseClient,
  userId: string,
  eventId: string,
  date: string,
) {
  const { data: master, error: masterErr } = await client
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('owner_id', userId)
    .eq('is_master', true)
    .maybeSingle();
  if (masterErr) return dbError(masterErr, 'events:cancel:master');
  if (!master) return notFound('Event');

  const row = {
    owner_id: userId,
    master_event_id: eventId,
    recurrence_exception_date: date,
    is_master: false,
    is_cancelled: true,
  };

  const { error } = await client
    .from('events')
    .upsert(row, { onConflict: 'master_event_id,recurrence_exception_date' });

  if (error) return dbError(error, 'events:cancel');
  // 202 with a null payload — EmptyResult, per the contract.
  return ok(null, 202);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Reject an RRULE the engine cannot expand.
 *
 * Without this, an unsupported rule is stored happily and then blows up (or,
 * worse, silently yields nothing) every time the calendar is read. Validating
 * on write keeps bad rules out of the database entirely.
 */
function validateRecurrenceRule(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    return '"recurrenceRule" must be a non-empty RRULE string or null.';
  }
  try {
    parseRRule(value);
  } catch (error) {
    if (error instanceof UnsupportedRRuleError) {
      return `"recurrenceRule" is not supported: ${error.message}`;
    }
    return '"recurrenceRule" is not a valid RRULE.';
  }
  return null;
}

function validateEventWrite(body: Record<string, unknown>): string | null {
  if (typeof body.title !== 'string' || body.title.trim() === '') return '"title" is required.';
  if (typeof body.localStart !== 'string' || !LOCAL_DT_RE.test(body.localStart)) {
    return '"localStart" is required as YYYY-MM-DDTHH:mm[:ss].';
  }
  if (typeof body.localEnd !== 'string' || !LOCAL_DT_RE.test(body.localEnd)) {
    return '"localEnd" is required as YYYY-MM-DDTHH:mm[:ss].';
  }
  // Naive wall-clock strings of equal shape compare correctly as strings.
  if (body.localEnd <= body.localStart) return '"localEnd" must be after "localStart".';

  const tzError = validateTimezone(body.timezoneId);
  if (tzError) return tzError;

  if (!VISIBILITIES.includes(body.visibility as string)) {
    return `"visibility" must be one of: ${VISIBILITIES.join(', ')}.`;
  }

  const ruleError = validateRecurrenceRule(body.recurrenceRule);
  if (ruleError) return ruleError;

  if (body.isVariableSchedule === true && body.recurrenceRule) {
    return 'A variable-schedule event must not also carry a "recurrenceRule".';
  }
  return null;
}

/** Only validates the fields actually present in a PATCH body. */
function validateEventPatch(body: Record<string, unknown>): string | null {
  if ('title' in body && (typeof body.title !== 'string' || body.title.trim() === '')) {
    return '"title" must be a non-empty string.';
  }
  if (
    'localStart' in body &&
    (typeof body.localStart !== 'string' || !LOCAL_DT_RE.test(body.localStart))
  ) {
    return '"localStart" must be YYYY-MM-DDTHH:mm[:ss].';
  }
  if (
    'localEnd' in body &&
    (typeof body.localEnd !== 'string' || !LOCAL_DT_RE.test(body.localEnd))
  ) {
    return '"localEnd" must be YYYY-MM-DDTHH:mm[:ss].';
  }
  if (
    typeof body.localStart === 'string' &&
    typeof body.localEnd === 'string' &&
    body.localEnd <= body.localStart
  ) {
    return '"localEnd" must be after "localStart".';
  }
  if ('timezoneId' in body) {
    const tzError = validateTimezone(body.timezoneId);
    if (tzError) return tzError;
  }
  if ('visibility' in body && !VISIBILITIES.includes(body.visibility as string)) {
    return `"visibility" must be one of: ${VISIBILITIES.join(', ')}.`;
  }
  if ('recurrenceRule' in body) {
    const ruleError = validateRecurrenceRule(body.recurrenceRule);
    if (ruleError) return ruleError;
  }
  return null;
}

/**
 * An override is sparse — every declared field is optional, but the contract's
 * `OccurrenceOverride` sets `additionalProperties: false` and `minProperties: 1`,
 * so an empty body and undeclared keys (previously `timezoneId` and `sharedWith`
 * were silently persisted) are rejected rather than absorbed.
 */
function validateOccurrenceOverride(body: Record<string, unknown>): string | null {
  const keys = Object.keys(body);
  if (keys.length === 0) return 'An override must set at least one field.';
  // Object.hasOwn, not `in`: `in` walks the prototype chain, so a body of
  // {"toString": 1} was accepted as a known field, set nothing, and still
  // upserted is_cancelled:false — quietly reinstating a cancelled occurrence
  // and answering 200 for a request that named no real field at all.
  const unknown = keys.filter((k) => !Object.hasOwn(OVERRIDE_FIELDS, k));
  if (unknown.length > 0) {
    return `Unknown field(s) for an occurrence override: ${unknown.join(', ')}.`;
  }

  if ('title' in body && (typeof body.title !== 'string' || body.title.trim() === '')) {
    return '"title" must be a non-empty string.';
  }
  for (const key of ['description', 'location', 'colorLabel'] as const) {
    if (key in body && body[key] !== null && typeof body[key] !== 'string') {
      return `"${key}" must be a string or null.`;
    }
  }
  for (const key of ['localStart', 'localEnd'] as const) {
    if (key in body && (typeof body[key] !== 'string' || !LOCAL_DT_RE.test(body[key] as string))) {
      return `"${key}" must be YYYY-MM-DDTHH:mm[:ss].`;
    }
  }
  if (
    typeof body.localStart === 'string' &&
    typeof body.localEnd === 'string' &&
    body.localEnd <= body.localStart
  ) {
    return '"localEnd" must be after "localStart".';
  }
  if ('visibility' in body && !VISIBILITIES.includes(body.visibility as string)) {
    return `"visibility" must be one of: ${VISIBILITIES.join(', ')}.`;
  }
  return null;
}
