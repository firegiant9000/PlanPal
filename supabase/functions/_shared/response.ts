/** Shared response helpers for all Edge Functions. */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

export const methodNotAllowed = (): Response =>
  err('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);

export const handleOptions = (): Response =>
  new Response(null, { status: 204, headers: corsHeaders });
