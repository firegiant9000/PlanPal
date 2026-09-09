/**
 * /friend-code — the caller's active friend code (M3, T12).
 *
 * Routes:
 *   GET  /friend-code          the active code
 *   POST /friend-code/rotate   issue a new one, expiring the old after 30 days
 *
 * Rotation is a single RPC rather than an expire-then-insert pair here. The
 * `friend_codes_one_active_per_user` index is partial (WHERE expires_at IS
 * NULL), so two statements race: concurrent rotations both expire the same row
 * and both insert, and the second violates the index. An interruption between
 * them is worse — it leaves the user with no active code and no route back to
 * one. See 20260903000003.
 */
import { getUserClient, type DbClient } from '../_shared/auth.ts';
import {
  dbError,
  handleOptions,
  methodNotAllowed,
  notFound,
  ok,
  unauthenticated,
} from '../_shared/response.ts';
import { toFriendCodeModel } from '../_shared/serialize.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  // segments[0] = "friend-code", [1] = "rotate"?
  const sub = segments[1] ?? null;

  if (sub === 'rotate') {
    if (req.method === 'POST') return rotate(client);
    return methodNotAllowed();
  }

  if (sub !== null) return notFound('Route');

  if (req.method === 'GET') return getActive(client, userId);
  return methodNotAllowed();
});

async function getActive(client: DbClient, userId: string) {
  const { data, error } = await client
    .from('friend_codes')
    .select('*')
    .eq('user_id', userId)
    // The active code is the one that has not been rotated out. Filtering on
    // this rather than ordering by created_at means the answer matches the
    // partial unique index exactly, so it cannot return an expired code even
    // if an old row somehow sorts first.
    .is('expires_at', null)
    .maybeSingle();

  if (error) return dbError(error, 'friend-code:get');
  // handle_new_user issues a code at signup, so a missing row is a real fault
  // rather than an empty state the client should render.
  if (!data) return notFound('Friend code');

  return ok(toFriendCodeModel(data));
}

async function rotate(client: DbClient) {
  // The RPC reads auth.uid() itself, so there is no user id to pass and no way
  // to aim it at another account.
  const { data, error } = await client.rpc('rotate_friend_code');

  if (error) return dbError(error, 'friend-code:rotate');
  if (!data) return dbError(null, 'friend-code:rotate:empty');

  return ok(toFriendCodeModel(data));
}
