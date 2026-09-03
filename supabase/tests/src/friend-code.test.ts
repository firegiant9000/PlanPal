import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  callFn,
  createTestUser,
  deleteTestUser,
  expectErr,
  expectOk,
  requireLocalStack,
  type TestUser,
} from './harness';
import { query } from './db';

/** Exactly the `FriendCode` schema — three properties. */
interface FriendCode {
  code: string;
  expiresAt: string | null;
  createdAt: string;
}

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('fc');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('GET /friend-code', () => {
  it('returns the code handle_new_user issued at signup', async () => {
    const fc = expectOk(await callFn<FriendCode>('friend-code', { token: user.accessToken }));

    expect(fc.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(fc.expiresAt).toBeNull(); // null while active
    expect(fc.createdAt).toEqual(expect.any(String));
    // Nothing beyond the schema — no row id, no user_id.
    expect(Object.keys(fc).sort()).toEqual(['code', 'createdAt', 'expiresAt']);
  });

  it('401s without a user token', async () => {
    const res = await callFn('friend-code', { token: ANON_KEY });
    expect(expectErr(res, 401).code).toBe('UNAUTHENTICATED');
  });

  it('405s an unsupported verb', async () => {
    const res = await callFn('friend-code', { method: 'DELETE', token: user.accessToken });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });

  it("does not return another user's code", async () => {
    const other = await createTestUser('fc-other');
    try {
      const mine = expectOk(await callFn<FriendCode>('friend-code', { token: user.accessToken }));
      const theirs = expectOk(
        await callFn<FriendCode>('friend-code', { token: other.accessToken }),
      );
      expect(mine.code).not.toBe(theirs.code);
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

describe('POST /friend-code/rotate', () => {
  it('issues a new active code and grace-expires the old one', async () => {
    const rotator = await createTestUser('fc-rotate');
    try {
      const before = expectOk(
        await callFn<FriendCode>('friend-code', { token: rotator.accessToken }),
      );

      const after = expectOk(
        await callFn<FriendCode>('friend-code/rotate', {
          method: 'POST',
          token: rotator.accessToken,
        }),
      );

      expect(after.code).not.toBe(before.code);
      expect(after.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(after.expiresAt).toBeNull();

      // The old code survives with a 30-day expiry — existing connections that
      // were made with it must not break the moment someone rotates.
      const rows = await query<{ code: string; expires_at: Date | null }>(
        `select code, expires_at from public.friend_codes where user_id = $1 order by created_at`,
        [rotator.id],
      );
      expect(rows).toHaveLength(2);

      const old = rows.find((r) => r.code === before.code);
      expect(old?.expires_at).not.toBeNull();
      const days = (Date.parse(String(old!.expires_at)) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29);
      expect(days).toBeLessThan(31);

      // And GET now returns the new one, not the expired one.
      const fetched = expectOk(
        await callFn<FriendCode>('friend-code', { token: rotator.accessToken }),
      );
      expect(fetched.code).toBe(after.code);
    } finally {
      await deleteTestUser(rotator.id);
    }
  });

  it('leaves exactly one active code after repeated rotation', async () => {
    const rotator = await createTestUser('fc-repeat');
    try {
      const seen = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const fc = expectOk(
          await callFn<FriendCode>('friend-code/rotate', {
            method: 'POST',
            token: rotator.accessToken,
          }),
        );
        seen.add(fc.code);
      }
      expect(seen.size).toBe(4);

      const active = await query(
        `select 1 from public.friend_codes where user_id = $1 and expires_at is null`,
        [rotator.id],
      );
      expect(active, 'the partial unique index must hold').toHaveLength(1);
    } finally {
      await deleteTestUser(rotator.id);
    }
  });

  it('is race-free under concurrent rotation', async () => {
    // The reason rotation is one RPC. As an expire-then-insert pair from the
    // Edge Function, two simultaneous rotations both expire the same row and
    // both insert, and the second violates friend_codes_one_active_per_user.
    // Worse, an interruption between the two statements leaves the user with
    // NO active code at all.
    //
    // This caught a real bug that the first RPC did not fix: locking the
    // active code row does not serialise anything, because the row stops
    // matching `expires_at is null` the instant it is expired, and the blocked
    // waiters are then released without a lock. It surfaced as a 409 on about
    // one full-suite run in three. 20260903000005 locks the user row instead.
    //
    // Eight concurrent callers rather than five, because the failure was
    // probabilistic and a thin test would let it back in unnoticed.
    const racer = await createTestUser('fc-race');
    try {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          callFn<FriendCode>('friend-code/rotate', {
            method: 'POST',
            token: racer.accessToken,
          }),
        ),
      );

      // Every call succeeds — rotation is not an operation that should ever
      // return a conflict to the caller.
      for (const res of results) {
        expect(res.status, `got ${res.status}: ${res.text.slice(0, 200)}`).toBe(200);
      }

      const active = await query<{ code: string }>(
        `select code from public.friend_codes where user_id = $1 and expires_at is null`,
        [racer.id],
      );
      expect(active, 'exactly one active code must remain').toHaveLength(1);

      // And never zero, which is the unrecoverable state.
      expect(active[0]?.code).toMatch(/^[A-Z0-9]{8}$/);
    } finally {
      await deleteTestUser(racer.id);
    }
  });

  it('405s a GET on the rotate path', async () => {
    const res = await callFn('friend-code/rotate', { token: user.accessToken });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });

  it('401s without a user token', async () => {
    const res = await callFn('friend-code/rotate', { method: 'POST', token: ANON_KEY });
    expect(expectErr(res, 401).code).toBe('UNAUTHENTICATED');
  });

  it("cannot rotate another user's code", async () => {
    // rotate_friend_code() takes no arguments and reads auth.uid() itself, so
    // there is no parameter to point at someone else. Assert the outcome.
    const victim = await createTestUser('fc-victim');
    try {
      const theirs = expectOk(
        await callFn<FriendCode>('friend-code', { token: victim.accessToken }),
      );

      expectOk(
        await callFn<FriendCode>('friend-code/rotate', {
          method: 'POST',
          token: user.accessToken,
        }),
      );

      const stillTheirs = expectOk(
        await callFn<FriendCode>('friend-code', { token: victim.accessToken }),
      );
      expect(stillTheirs.code).toBe(theirs.code);
    } finally {
      await deleteTestUser(victim.id);
    }
  });
});

describe('generate_friend_code uses a CSPRNG', () => {
  it('produces codes matching the column check constraint', async () => {
    const rows = await query<{ c: string }>(
      `select public.generate_friend_code() as c from generate_series(1, 200)`,
    );
    expect(rows).toHaveLength(200);
    expect(rows.every((r) => /^[A-Z0-9]{8}$/.test(r.c))).toBe(true);
    // Collisions at this sample size would indicate a badly broken generator.
    expect(new Set(rows.map((r) => r.c)).size).toBe(200);
  });

  it('draws from gen_random_bytes, not random()', async () => {
    // random() is a deterministic PRNG seeded per session: setseed() makes it
    // reproduce exactly. A CSPRNG ignores the seed entirely, so identical
    // output across two seeded draws is the signal that random() came back.
    const first = await query<{ c: string }>(
      `select setseed(0.5), public.generate_friend_code() as c`,
    );
    const second = await query<{ c: string }>(
      `select setseed(0.5), public.generate_friend_code() as c`,
    );
    expect(first[0]?.c).not.toBe(second[0]?.c);
  });

  it('covers the whole alphabet without modulo bias', async () => {
    // 256 is not a multiple of 36, so a naive byte % 36 would over-represent
    // the first four symbols. Bytes >= 252 are rejected to prevent that.
    const rows = await query<{ ch: string; n: string }>(
      `
      with chars as (
        select regexp_split_to_table(string_agg(public.generate_friend_code(), ''), '') as ch
          from generate_series(1, 600)
      )
      select ch, count(*)::text as n from chars where ch <> '' group by ch
      `,
    );
    const counts = rows.map((r) => Number(r.n));
    expect(rows).toHaveLength(36);
    // 4800 characters over 36 symbols is ~133 each. A wide band, because this
    // is a randomness check and a tight one would flake; modulo bias would
    // show as the first four letters roughly 14% high, well outside it.
    expect(Math.min(...counts)).toBeGreaterThan(80);
    expect(Math.max(...counts)).toBeLessThan(190);
  });
});
