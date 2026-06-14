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
import { getUserClient } from '../_shared/auth.ts';
import {
  badRequest,
  handleOptions,
  methodNotAllowed,
  notFound,
  ok,
  unauthenticated,
} from '../_shared/response.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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

async function listEvents(client: ReturnType<typeof createClientSig>, userId: string, url: URL) {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100);
  const cursor = url.searchParams.get('cursor');

  let query = client
    .from('events')
    .select('*')
    .eq('owner_id', userId)
    .eq('is_master', true)
    .order('created_at', { ascending: true })
    .limit(limit + 1);

  if (cursor) query = query.gt('id', cursor);

  const { data, error } = await query;
  if (error) return dbError(error.message);

  const items = data ?? [];
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

  return ok({ items: page, nextCursor });
}

async function createEvent(client: ReturnType<typeof createClientSig>, userId: string, req: Request) {
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
  if (error) return dbError(error.message);
  return ok(data, 201);
}

async function getEvent(client: ReturnType<typeof createClientSig>, userId: string, eventId: string) {
  const { data, error } = await client
    .from('events').select('*').eq('id', eventId).eq('owner_id', userId).maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return notFound('Event');
  return ok(data);
}

async function updateEvent(
  client: ReturnType<typeof createClientSig>,
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

  const { data, error } = await client
    .from('events').update(patch).eq('id', eventId).eq('owner_id', userId).select().maybeSingle();
  if (error) return dbError(error.message);
  if (!data) return notFound('Event');
  return ok(data);
}

async function deleteEvent(client: ReturnType<typeof createClientSig>, userId: string, eventId: string) {
  const { error } = await client
    .from('events').delete().eq('id', eventId).eq('owner_id', userId);
  if (error) return dbError(error.message);
  return ok({ deleted: true }, 200);
}

async function upsertOccurrenceOverride(
  client: ReturnType<typeof createClientSig>,
  userId: string,
  eventId: string,
  date: string,
  req: Request,
) {
  // Verify the master belongs to this user.
  const { data: master } = await client
    .from('events').select('id').eq('id', eventId).eq('owner_id', userId).maybeSingle();
  if (!master) return notFound('Event');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return badRequest('Request body must be valid JSON.'); }

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

  if (error) return dbError(error.message);
  return ok(data);
}

async function cancelOccurrence(
  client: ReturnType<typeof createClientSig>,
  userId: string,
  eventId: string,
  date: string,
) {
  const { data: master } = await client
    .from('events').select('id').eq('id', eventId).eq('owner_id', userId).maybeSingle();
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

  if (error) return dbError(error.message);
  return ok({ cancelled: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEventWrite(body: Record<string, unknown>): string | null {
  if (typeof body.title !== 'string' || body.title.trim() === '') return '"title" is required.';
  if (typeof body.localStart !== 'string') return '"localStart" is required.';
  if (typeof body.localEnd !== 'string') return '"localEnd" is required.';
  if (typeof body.timezoneId !== 'string') return '"timezoneId" is required.';
  const vis = body.visibility;
  if (!['private', 'shared_all', 'shared_select', 'sensitive_public'].includes(vis as string)) {
    return '"visibility" must be one of: private, shared_all, shared_select, sensitive_public.';
  }
  return null;
}

function dbError(msg: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code: 'DB_ERROR', message: msg } }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Type helper — keeps TS happy without importing SupabaseClient type into the function.
type createClientSig = { from: (t: string) => ReturnType<ReturnType<typeof Object.create>> };
