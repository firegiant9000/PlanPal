/** Shared response helpers for all Edge Functions. */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

export const ok = <T>(data: T, status = 200): Response =>
  json({ ok: true, data }, status);

export const err = (code: string, message: string, status: number, details?: unknown): Response =>
  json({ ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } }, status);

export const unauthenticated = (): Response =>
  err('UNAUTHENTICATED', 'Authentication required.', 401);

export const notFound = (resource = 'Resource'): Response =>
  err('NOT_FOUND', `${resource} not found.`, 404);

export const badRequest = (message: string, details?: unknown): Response =>
  err('VALIDATION_ERROR', message, 400, details);

export const conflict = (message: string): Response => err('CONFLICT', message, 409);

export const methodNotAllowed = (): Response =>
  err('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);

export const handleOptions = (): Response =>
  new Response(null, { status: 204, headers: corsHeaders });

/** A Postgres error as surfaced by PostgREST. */
interface PostgrestLikeError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

/**
 * Postgres error codes that are the caller's fault, not the server's. These
 * are mapped to 4xx with a generic message; everything else becomes a 500.
 */
const CLIENT_FAULT_CODES: Record<string, { status: number; code: string; message: string }> = {
  '23502': { status: 400, code: 'VALIDATION_ERROR', message: 'A required field was missing.' },
  '23503': { status: 400, code: 'VALIDATION_ERROR', message: 'A referenced record does not exist.' },
  '23505': { status: 409, code: 'CONFLICT', message: 'That record already exists.' },
  '23514': { status: 400, code: 'VALIDATION_ERROR', message: 'A field failed a validation rule.' },
  '22007': { status: 400, code: 'VALIDATION_ERROR', message: 'A date or time value was malformed.' },
  '22023': { status: 400, code: 'VALIDATION_ERROR', message: 'A field value was invalid.' },
  '42501': { status: 403, code: 'FORBIDDEN', message: 'You do not have access to that record.' },
};

/**
 * Convert a database error into a safe response.
 *
 * Raw Postgres messages leak schema internals (table/column/constraint names,
 * and occasionally row values) so they are logged server-side and never
 * returned to the caller. Constraint violations the client caused are mapped
 * to 4xx; anything else is an opaque 500.
 */
export const dbError = (error: PostgrestLikeError | null, context: string): Response => {
  console.error(`[db] ${context}`, {
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  });

  const mapped = error?.code ? CLIENT_FAULT_CODES[error.code] : undefined;
  if (mapped) return err(mapped.code, mapped.message, mapped.status);

  return err('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
};
