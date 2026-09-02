/**
 * Extract and verify the caller's Supabase JWT, returning a scoped client
 * tied to the user's session (RLS applies). Returns null if the token is
 * missing or invalid.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function getUserClient(req: Request): Promise<{
  client: SupabaseClient;
  userId: string;
} | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) return null;

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  return { client, userId: data.user.id };
}
