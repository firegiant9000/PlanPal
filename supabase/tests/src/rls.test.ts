import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON_KEY, SUPABASE_URL, createTestUser, deleteTestUser, type TestUser } from './harness';
import { query } from './db';

/**
 * RLS regression tests: user A must not read user B's rows (§13).
 *
 * These go through PostgREST rather than a direct connection, with real
 * end-user JWTs, because that is the path RLS actually has to hold on. A
 * superuser connection bypasses RLS entirely and would report success no matter
 * what the policies said.
 *
 * Note this covers the *owner's own* enforcement only. Cross-user visibility
 * through the friend graph does not exist until M6, and the sensitive-public
 * redaction RPCs are M7 — MONTH_3_4_PLAN records that as a known limit of the
 * MVP gate, and it stays true here.
 */

/** Query a table as a signed-in end user, through PostgREST. */
async function selectAs(
  user: TestUser,
  table: string,
  params = '',
): Promise<{ status: number; rows: Array<Record<string, unknown>> }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${params}`, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${user.accessToken}`,
    },
  });
  const text = await res.text();
  let rows: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch {
    rows = [];
  }
  return { status: res.status, rows };
}

let alice: TestUser;
let bob: TestUser;
let bobEventId: string;

beforeAll(async () => {
  alice = await createTestUser('rls-alice');
  bob = await createTestUser('rls-bob');

  // Give Bob a private event, a device and a birthday-derived row, seeded
  // directly so the test does not depend on the API surface it is auditing.
  const rows = await query<{ id: string }>(
    `insert into public.events
       (owner_id, title, local_start, local_end, timezone_id, visibility, is_master)
     values ($1, 'Bob private', '2026-09-07 09:00', '2026-09-07 09:30',
             'America/New_York', 'private', true)
     returning id`,
    [bob.id],
  );
  bobEventId = rows[0]!.id;

  await query(
    `insert into public.devices (user_id, expo_push_token, platform)
     values ($1, $2, 'ios')
     on conflict (expo_push_token) do nothing`,
    [bob.id, `ExponentPushToken[rls-${bob.id}]`],
  );
});

afterAll(async () => {
  if (alice) await deleteTestUser(alice.id);
  if (bob) await deleteTestUser(bob.id);
});

describe('events', () => {
  it("Alice cannot read Bob's event", async () => {
    const { rows } = await selectAs(alice, 'events', `&id=eq.${bobEventId}`);
    expect(rows).toEqual([]);
  });

  it('Alice can read her own events', async () => {
    await query(
      `insert into public.events
         (owner_id, title, local_start, local_end, timezone_id, visibility, is_master)
       values ($1, 'Alice own', '2026-09-08 09:00', '2026-09-08 09:30',
               'America/New_York', 'private', true)`,
      [alice.id],
    );
    const { rows } = await selectAs(alice, 'events');
    // Proves the empty result above is enforcement, not a broken query.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.owner_id === alice.id)).toBe(true);
  });

  it("Alice cannot update Bob's event", async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${bobEventId}`, {
      method: 'PATCH',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${alice.accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    const body = await res.json();
    expect(Array.isArray(body) ? body : []).toEqual([]);

    const [row] = await query<{ title: string }>(`select title from public.events where id = $1`, [
      bobEventId,
    ]);
    expect(row?.title).toBe('Bob private');
  });

  it("Alice cannot delete Bob's event", async () => {
    await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${bobEventId}`, {
      method: 'DELETE',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${alice.accessToken}` },
    });
    const rows = await query(`select 1 from public.events where id = $1`, [bobEventId]);
    expect(rows.length).toBe(1);
  });
});

describe('users', () => {
  it("Alice cannot read Bob's profile row", async () => {
    const { rows } = await selectAs(alice, 'users', `&id=eq.${bob.id}`);
    expect(rows).toEqual([]);
  });

  it('Alice can read her own profile row', async () => {
    const { rows } = await selectAs(alice, 'users', `&id=eq.${alice.id}`);
    expect(rows).toHaveLength(1);
  });
});

describe('devices', () => {
  it("Alice cannot read Bob's push tokens", async () => {
    const { rows } = await selectAs(alice, 'devices', `&user_id=eq.${bob.id}`);
    expect(rows).toEqual([]);
  });
});

describe('notification_preferences', () => {
  it("Alice cannot read Bob's notification preferences", async () => {
    // handle_new_user creates one per signup, so Bob's row exists.
    const seeded = await query(`select 1 from public.notification_preferences where user_id = $1`, [
      bob.id,
    ]);
    expect(seeded.length, "Bob's preferences row was not created by handle_new_user").toBe(1);

    const { rows } = await selectAs(alice, 'notification_preferences', `&user_id=eq.${bob.id}`);
    expect(rows).toEqual([]);
  });
});

describe('friend_codes', () => {
  it("Alice cannot read Bob's friend code", async () => {
    const seeded = await query(`select 1 from public.friend_codes where user_id = $1`, [bob.id]);
    expect(seeded.length, "Bob's friend code was not created by handle_new_user").toBe(1);

    const { rows } = await selectAs(alice, 'friend_codes', `&user_id=eq.${bob.id}`);
    expect(rows).toEqual([]);
  });
});

describe('notification_sends', () => {
  it('is not readable by an end user at all', async () => {
    // The M2 hardening migration revoked anon/authenticated table grants here;
    // it is scheduler bookkeeping, not user-facing data.
    const { rows } = await selectAs(alice, 'notification_sends');
    expect(rows).toEqual([]);
  });
});

describe('anonymous access', () => {
  it('cannot read events with only the anon key', async () => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/events?select=*`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    const body = await res.json();
    expect(Array.isArray(body) ? body : []).toEqual([]);
  });
});
