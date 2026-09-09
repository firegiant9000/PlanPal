/**
 * Extract and verify the caller's Supabase JWT, returning a scoped client
 * tied to the user's session (RLS applies). Returns null if the token is
 * missing or invalid.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import type { Database } from './database.types.ts';

/**
 * The user-scoped client, parameterised by the generated schema.
 *
 * This one type argument is what makes every handler's `.from('events')`
 * return a real row type instead of `any`, and so is what let the 22
 * `as unknown as EventRowFull` casts be deleted (T32/AD-11). Exported so
 * handlers annotate their helpers with it rather than the bare
 * `SupabaseClient`, which would silently discard the schema again.
 */
export type DbClient = SupabaseClient<Database>;

export async function getUserClient(req: Request): Promise<{
  client: DbClient;
  userId: string;
} | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return null;

  const client = createClient<Database>(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  return { client, userId: data.user.id };
}
