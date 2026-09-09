/**
 * Request body parsing.
 *
 * `await req.json()` succeeds on any valid JSON document, not just an object.
 * A body of literal `null`, `true`, `"x"` or `[]` parses cleanly and then blows
 * up on the first property access or `in` check — `TypeError: Cannot use 'in'
 * operator` for `null` — which escapes the handler as a bare 500 with no error
 * envelope at all. Every handler that reads a JSON object needs the same two
 * checks, so they live here rather than being repeated and occasionally
 * forgotten.
 */
import { badRequest } from './response.ts';

export type JsonObject = Record<string, unknown>;

/**
 * Parse a request body as a JSON object.
 *
 * Returns the object, or a 400 Response to return directly. Callers branch on
 * `instanceof Response` so the failure is impossible to ignore by accident.
 */
export async function readJsonObject(req: Request): Promise<JsonObject | Response> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return badRequest('Request body must be valid JSON.');
  }

  // Arrays are objects to `typeof`, and `null` is too. Both would survive a
  // naive check and fail later in a much less helpful place.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return badRequest('Request body must be a JSON object.');
  }

  return parsed as JsonObject;
}
