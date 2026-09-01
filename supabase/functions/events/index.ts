/**
 * /events — master event CRUD (M2).
 *
 * Routes:
 *   GET    /events                             list master events (paginated)
 *   POST   /events                             create a master/standalone event
 *   GET    /events/:id                         get one event
 *   PATCH  /events/:id                         update master (ALL scope)
 *   DELETE /events/:id                         delete master + all exceptions
 *   PUT    /events/:id/occurrences/:date       THIS-override an occurrence
 *   DELETE /events/:id/occurrences/:date       THIS-cancel an occurrence
 */
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserClient } from '../_shared/auth.ts';
import {
  badRequest,
  dbError,
  handleOptions,
  methodNotAllowed,
  notFound,
  ok,
  unauthenticated,
} from '../_shared/response.ts';
import { parseRRule, UnsupportedRRuleError } from '../_shared/recurrence/index.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBILITIES = ['private', 'shared_all', 'shared_select', 'sensitive_public'];

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
  if (isOccurrencePath && occurrenceDate) {
    if (!DATE_RE.test(occurrenceDate)) return badRequest('Occurrence date must be YYYY-MM-DD.');
    if (req.method === 'PUT') return upsertOccurrenceOverride(client, userId, eventId, occurrenceDate, req);
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

  return ok({ items: page, nextCursor });
}

async function createEvent(client: SupabaseClient, userId: string, req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Request body must be valid JSON.'); }

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
  return ok(data, 201);
}

async function getEvent(client: SupabaseClient, userId: string, eventId: string) {
  const { data, error } = await client
    .from('events').select('*').eq('id', eventId).eq('owner_id', userId).maybeSingle();
  if (error) return dbError(error, 'events:get');
  if (!data) return notFound('Event');
  return ok(data);
}

async function updateEvent(
  client: SupabaseClient,
  userId: string,
  eventId: string,
  req: Request,
) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Request body must be valid JSON.'); }

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
    if (clientKey in body) patch[dbKey] = body[clientKey];
  }

  if (Object.keys(patch).length === 0) return badRequest('No updatable fields provided.');

  const validation = validateEventPatch(body);
  if (validation) return badRequest(validation);

  const { data, error } = await client
    .from('events').update(patch).eq('id', eventId).eq('owner_id', userId).select().maybeSingle();
  if (error) return dbError(error, 'events:update');
  if (!data) return notFound('Event');
  return ok(data);
}

async function deleteEvent(client: SupabaseClient, userId: string, eventId: string) {
  // `select()` so a delete that matched nothing is reported as 404 rather than
  // a misleading success.
  const { data, error } = await client
    .from('events').delete().eq('id', eventId).eq('owner_id', userId).select('id');
  if (error) return dbError(error, 'events:delete');
  if (!data || data.length === 0) return notFound('Event');
  return ok({ deleted: true });
}

async function upsertOccurrenceOverride(
  client: SupabaseClient,
  userId: string,
  eventId: string,
  date: string,
  req: Request,
) {
  // Verify the master belongs to this user.
  const { data: master, error: masterErr } = await client
    .from('events').select('id').eq('id', eventId).eq('owner_id', userId)
    .eq('is_master', true).maybeSingle();
  if (masterErr) return dbError(masterErr, 'events:override:master');
  if (!master) return notFound('Event');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Request body must be valid JSON.'); }

  const validation = validateOccurrenceOverride(body);
  if (validation) return badRequest(validation);

  const row = {
    owner_id: userId,
    master_event_id: eventId,
    recurrence_exception_date: date,
    is_master: false,
    is_cancelled: false,
    title: (body.title as string | null) ?? null,
    description: (body.description as string | null) ?? null,
    location: (body.location as string | null) ?? null,
    local_start: (body.localStart as string | null) ?? null,
    local_end: (body.localEnd as string | null) ?? null,
    timezone_id: (body.timezoneId as string | null) ?? null,
    visibility: (body.visibility as string | null) ?? null,
    color_label: (body.colorLabel as string | null) ?? null,
    shared_with: (body.sharedWith as string[] | null) ?? [],
  };

  const { data, error } = await client
    .from('events')
    .upsert(row, { onConflict: 'master_event_id,recurrence_exception_date' })
    .select()
    .single();

  if (error) return dbError(error, 'events:override');
  return ok(data);
}

async function cancelOccurrence(
  client: SupabaseClient,
  userId: string,
  eventId: string,
  date: string,
) {
  const { data: master, error: masterErr } = await client
    .from('events').select('id').eq('id', eventId).eq('owner_id', userId)
    .eq('is_master', true).maybeSingle();
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
  return ok({ cancelled: true });
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

/** IANA zone check — `Intl` is the authority already used by the engine. */
function validateTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return '"timezoneId" is required.';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    return `"timezoneId" is not a recognised IANA timezone: ${value}`;
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
  if ('localStart' in body && (typeof body.localStart !== 'string' || !LOCAL_DT_RE.test(body.localStart))) {
    return '"localStart" must be YYYY-MM-DDTHH:mm[:ss].';
  }
  if ('localEnd' in body && (typeof body.localEnd !== 'string' || !LOCAL_DT_RE.test(body.localEnd))) {
    return '"localEnd" must be YYYY-MM-DDTHH:mm[:ss].';
  }
  if (typeof body.localStart === 'string' && typeof body.localEnd === 'string'
      && body.localEnd <= body.localStart) {
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

/** An override is sparse — every field is optional, but must be well-formed. */
function validateOccurrenceOverride(body: Record<string, unknown>): string | null {
  if ('localStart' in body && body.localStart !== null
      && (typeof body.localStart !== 'string' || !LOCAL_DT_RE.test(body.localStart))) {
    return '"localStart" must be YYYY-MM-DDTHH:mm[:ss] or null.';
  }
  if ('localEnd' in body && body.localEnd !== null
      && (typeof body.localEnd !== 'string' || !LOCAL_DT_RE.test(body.localEnd))) {
    return '"localEnd" must be YYYY-MM-DDTHH:mm[:ss] or null.';
  }
  if (typeof body.localStart === 'string' && typeof body.localEnd === 'string'
      && body.localEnd <= body.localStart) {
    return '"localEnd" must be after "localStart".';
  }
  if ('timezoneId' in body && body.timezoneId !== null) {
    const tzError = validateTimezone(body.timezoneId);
    if (tzError) return tzError;
  }
  if ('visibility' in body && body.visibility !== null
      && !VISIBILITIES.includes(body.visibility as string)) {
    return `"visibility" must be one of: ${VISIBILITIES.join(', ')}.`;
  }
  return null;
}
