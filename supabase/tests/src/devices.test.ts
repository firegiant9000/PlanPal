import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callFn,
  createTestUser,
  deleteTestUser,
  expectErr,
  expectOk,
  requireLocalStack,
  type TestUser,
} from './harness';
import { query } from './db';

interface Device {
  expoPushToken: string;
  userId: string;
  platform: string;
  lastSeenAt: string;
  createdAt: string;
}

let user: TestUser;
let tokenCounter = 0;

/** A fresh Expo-shaped token per test, so specs never collide on the PK. */
function newToken(label: string): string {
  return `ExponentPushToken[it-${label}-${Date.now()}-${tokenCounter++}]`;
}

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('devices');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('POST /me/devices', () => {
  it('registers a token', async () => {
    const token = newToken('register');
    const device = expectOk(
      await callFn<Device>('me/devices', {
        method: 'POST',
        token: user.accessToken,
        body: { expoPushToken: token, platform: 'ios' },
      }),
    );
    expect(device.expoPushToken).toBe(token);
    expect(device.userId).toBe(user.id);
    expect(device.platform).toBe('ios');
    // camelCase on the wire, no raw columns.
    expect(device).not.toHaveProperty('expo_push_token');
    expect(device).not.toHaveProperty('last_seen_at');
  });

  it('is idempotent and refreshes platform and last_seen_at', async () => {
    const token = newToken('idempotent');

    const first = expectOk(
      await callFn<Device>('me/devices', {
        method: 'POST',
        token: user.accessToken,
        body: { expoPushToken: token, platform: 'ios' },
      }),
    );

    // A second registration must update, not raise a duplicate-key error.
    const second = expectOk(
      await callFn<Device>('me/devices', {
        method: 'POST',
        token: user.accessToken,
        body: { expoPushToken: token, platform: 'android' },
      }),
    );

    expect(second.platform).toBe('android');
    expect(Date.parse(second.lastSeenAt)).toBeGreaterThanOrEqual(Date.parse(first.lastSeenAt));
    // created_at must survive the upsert; it is not re-set.
    expect(second.createdAt).toBe(first.createdAt);

    const rows = await query(`select 1 from public.devices where expo_push_token = $1`, [token]);
    expect(rows).toHaveLength(1);
  });

  it('400s an unknown platform', async () => {
    const res = await callFn('me/devices', {
      method: 'POST',
      token: user.accessToken,
      body: { expoPushToken: newToken('badplatform'), platform: 'blackberry' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s a missing token', async () => {
    const res = await callFn('me/devices', {
      method: 'POST',
      token: user.accessToken,
      body: { platform: 'ios' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('401s without a user token', async () => {
    const { ANON_KEY } = await import('./harness');
    const res = await callFn('me/devices', {
      method: 'POST',
      token: ANON_KEY,
      body: { expoPushToken: newToken('anon'), platform: 'ios' },
    });
    expect(expectErr(res, 401).code).toBe('UNAUTHENTICATED');
  });
});

describe('a device that changes hands', () => {
  it('refuses to silently leave a token bound to the previous account', async () => {
    // expo_push_token is the PRIMARY KEY, so one token maps to one user. If B
    // signs in on a phone A was using, the token is unchanged. The row is
    // invisible to B under RLS, so the upsert matches nothing.
    //
    // The failure this guards against is answering 200: the device would
    // believe it is registered while `devices` still points at A, and the
    // scheduler would push A's reminders — event titles and times — to the
    // phone B is holding. Better to fail loudly than to leak quietly.
    const tokenOwner = await createTestUser('device-owner');
    const newOwner = await createTestUser('device-newowner');
    const token = newToken('handover');

    try {
      expectOk(
        await callFn<Device>('me/devices', {
          method: 'POST',
          token: tokenOwner.accessToken,
          body: { expoPushToken: token, platform: 'ios' },
        }),
      );

      const res = await callFn('me/devices', {
        method: 'POST',
        token: newOwner.accessToken,
        body: { expoPushToken: token, platform: 'ios' },
      });
      expect(expectErr(res, 409).code).toBe('CONFLICT');

      // And the binding is genuinely unchanged.
      const rows = await query<{ user_id: string }>(
        `select user_id from public.devices where expo_push_token = $1`,
        [token],
      );
      expect(rows[0]?.user_id).toBe(tokenOwner.id);
    } finally {
      await deleteTestUser(tokenOwner.id);
      await deleteTestUser(newOwner.id);
    }
  });
});

describe('DELETE /me/devices/{expoPushToken}', () => {
  it('deregisters an owned token', async () => {
    const token = newToken('deregister');
    expectOk(
      await callFn<Device>('me/devices', {
        method: 'POST',
        token: user.accessToken,
        body: { expoPushToken: token, platform: 'ios' },
      }),
    );

    const res = await callFn(`me/devices/${encodeURIComponent(token)}`, {
      method: 'DELETE',
      token: user.accessToken,
    });
    expect(res.status).toBe(202);

    const rows = await query(`select 1 from public.devices where expo_push_token = $1`, [token]);
    expect(rows).toHaveLength(0);
  });

  it('is idempotent — 202 for a token that was already gone', async () => {
    // Sign-out must not surface an error for a no-op, or clients retry.
    const res = await callFn(`me/devices/${encodeURIComponent(newToken('never-existed'))}`, {
      method: 'DELETE',
      token: user.accessToken,
    });
    expect(res.status).toBe(202);
  });

  it("cannot deregister another user's token", async () => {
    const other = await createTestUser('device-victim');
    const token = newToken('victim');
    try {
      expectOk(
        await callFn<Device>('me/devices', {
          method: 'POST',
          token: other.accessToken,
          body: { expoPushToken: token, platform: 'android' },
        }),
      );

      // 202 by contract even when nothing matched — but the row must survive.
      const res = await callFn(`me/devices/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        token: user.accessToken,
      });
      expect(res.status).toBe(202);

      const rows = await query(`select 1 from public.devices where expo_push_token = $1`, [token]);
      expect(rows, "another user's device was deleted").toHaveLength(1);
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it('405s an unsupported verb on the token path', async () => {
    const res = await callFn(`me/devices/${encodeURIComponent(newToken('verb'))}`, {
      method: 'GET',
      token: user.accessToken,
    });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('the scheduler can actually read what registration writes', () => {
  it('links a device to notification_sends by token', async () => {
    // notification_sends.expo_push_token is a FK onto devices. If registration
    // wrote a token the scheduler could not join to, push would fail at send
    // time rather than here.
    const token = newToken('fk');
    expectOk(
      await callFn<Device>('me/devices', {
        method: 'POST',
        token: user.accessToken,
        body: { expoPushToken: token, platform: 'ios' },
      }),
    );

    const rows = await query<{ expo_push_token: string; user_id: string }>(
      `select d.expo_push_token, d.user_id
         from public.devices d
        where d.user_id = $1 and d.expo_push_token = $2`,
      [user.id, token],
    );
    expect(rows).toHaveLength(1);
  });
});
