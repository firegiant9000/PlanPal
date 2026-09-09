/**
 * §P1's exit criterion: a sign-up provisions a complete profile.
 *
 * This goes through the PUBLIC `/auth/v1/signup` endpoint with the anon key —
 * the path a real user takes — rather than `harness.createTestUser`, which uses
 * the service-role admin API. Both insert into `auth.users` and so both fire
 * `on_auth_user_created`, but only one of them is the flow T7's screens drive,
 * and the provisioning has never been asserted anywhere.
 *
 * What makes this worth having: the trigger's failure mode is SILENT. A signup
 * whose trigger is missing still returns 200 and still creates an auth user —
 * it just leaves the account with no profile, no notification preferences and
 * no friend code. Nothing else in the suite would notice. (T30 found exactly
 * this: `supabase db dump` drops the trigger, so a restored database has it.)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON_KEY, SUPABASE_URL, deleteTestUser, requireLocalStack } from './harness';
import { query } from './db';

const createdUserIds: string[] = [];

async function signUpThroughGoTrue(): Promise<{ id: string; email: string }> {
  const email = `it-signup-${Date.now()}-${Math.random().toString(36).slice(2)}@planpal.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Sign-up failed: ${res.status} ${await res.text()}`);
  }

  // GoTrue returns the user at the top level, or nested under `user` depending
  // on whether a session was issued. Confirmations are on, so expect the former.
  const body = (await res.json()) as { id?: string; user?: { id?: string } };
  const id = body.id ?? body.user?.id;
  if (!id) throw new Error(`Sign-up returned no user id: ${JSON.stringify(body)}`);

  createdUserIds.push(id);
  return { id, email };
}

beforeAll(async () => {
  await requireLocalStack();
});

afterAll(async () => {
  for (const id of createdUserIds) await deleteTestUser(id);
});

describe('sign-up provisioning (§P1)', () => {
  it('a fresh sign-up produces users, notification_preferences and friend_codes rows', async () => {
    const { id } = await signUpThroughGoTrue();

    const rows = await query<{ users: string; prefs: string; codes: string }>(
      `select (select count(*) from public.users where id = $1)                    as users,
              (select count(*) from public.notification_preferences where user_id = $1) as prefs,
              (select count(*) from public.friend_codes where user_id = $1)        as codes`,
      [id],
    );

    expect(rows[0]).toEqual({ users: '1', prefs: '1', codes: '1' });
  });

  it('issues an active friend code, not merely a row', async () => {
    // A row with no active code is a half-provisioned account: the user exists
    // but cannot be added by anyone, which is indistinguishable from a bug in
    // the friend-code feature itself.
    const { id } = await signUpThroughGoTrue();

    const rows = await query<{ active: string }>(
      // `code is not null` is a table constraint and could never fail here, so
      // it is not asserted. Whether the issued code is ACTIVE can.
      `select count(*) as active from public.friend_codes
        where user_id = $1 and expires_at is null`,
      [id],
    );

    expect(rows[0]?.active).toBe('1');
  });
});
