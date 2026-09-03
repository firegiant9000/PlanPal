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

interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  birthday: string | null;
  defaultVisibility: string;
  timezoneId: string;
  lastActiveOptIn: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Prefs {
  userId: string;
  leadTimesMinutes: number[];
  pushEnabled: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  updatedAt: string;
}

/** Required properties of `Profile` / `NotificationPreference` in openapi.yaml. */
const PROFILE_REQUIRED = [
  'id',
  'username',
  'displayName',
  'defaultVisibility',
  'timezoneId',
  'createdAt',
  'updatedAt',
] as const;
const PREFS_REQUIRED = ['userId', 'leadTimesMinutes', 'pushEnabled', 'updatedAt'] as const;

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('me');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('GET /healthz', () => {
  it('is reachable without a user JWT', async () => {
    // security: [] in the contract. Kong still needs the anon key to route.
    const res = await callFn('healthz', { token: ANON_KEY });
    expect(expectOk(res)).toEqual({ status: 'ok' });
  });

  it('405s a non-GET verb', async () => {
    const res = await callFn('healthz', { token: ANON_KEY, method: 'POST', body: {} });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('GET /me', () => {
  it('returns the profile handle_new_user created at signup', async () => {
    const profile = expectOk(await callFn<Profile>('me', { token: user.accessToken }));

    for (const key of PROFILE_REQUIRED) {
      expect(profile, `missing required Profile property ${key}`).toHaveProperty(key);
    }
    // No raw columns on the wire.
    for (const key of ['display_name', 'default_visibility', 'timezone_id', 'created_at']) {
      expect(profile, `leaked raw column ${key}`).not.toHaveProperty(key);
    }

    expect(profile.id).toBe(user.id);
    // handle_new_user synthesises `user_<uid12>` so the NOT NULL holds before
    // onboarding collects a real one.
    expect(profile.username).toMatch(/^user_/);
    expect(profile.defaultVisibility).toBe('private');
  });

  it('never exposes last_active_at', async () => {
    // The column exists and is gated by lastActiveOptIn; it is not in the
    // Profile schema and must not leak through a `select *`.
    const profile = expectOk(await callFn<Profile>('me', { token: user.accessToken }));
    expect(profile).not.toHaveProperty('lastActiveAt');
    expect(profile).not.toHaveProperty('last_active_at');
  });

  it('401s without a user token', async () => {
    const res = await callFn('me', { token: ANON_KEY });
    expect(expectErr(res, 401).code).toBe('UNAUTHENTICATED');
  });
});

describe('PATCH /me', () => {
  it('updates allowed fields', async () => {
    const updated = expectOk(
      await callFn<Profile>('me', {
        method: 'PATCH',
        token: user.accessToken,
        body: { displayName: 'Renamed', defaultVisibility: 'shared_all' },
      }),
    );
    expect(updated.displayName).toBe('Renamed');
    expect(updated.defaultVisibility).toBe('shared_all');
  });

  it('409s a username already taken by someone else', async () => {
    const other = await createTestUser('me-other');
    try {
      const taken = `taken_${Date.now()}`;
      expectOk(
        await callFn<Profile>('me', {
          method: 'PATCH',
          token: other.accessToken,
          body: { username: taken },
        }),
      );

      const res = await callFn('me', {
        method: 'PATCH',
        token: user.accessToken,
        body: { username: taken },
      });
      const err = expectErr(res, 409);
      expect(err.code).toBe('CONFLICT');
      // The generic dbError wording is useless to someone typing a name.
      expect(err.message).toMatch(/username/i);
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it('400s an unknown field with no updatable content', async () => {
    const res = await callFn('me', {
      method: 'PATCH',
      token: user.accessToken,
      body: { notAField: 'x' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s a malformed username', async () => {
    const res = await callFn('me', {
      method: 'PATCH',
      token: user.accessToken,
      body: { username: 'no spaces allowed' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s an unrecognised IANA timezone rather than letting it reach the trigger', async () => {
    // An invalid zone stored here would make AT TIME ZONE raise on the next
    // event write — an opaque 500 on an unrelated request.
    const res = await callFn('me', {
      method: 'PATCH',
      token: user.accessToken,
      body: { timezoneId: 'Mars/Olympus_Mons' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s an invalid visibility', async () => {
    const res = await callFn('me', {
      method: 'PATCH',
      token: user.accessToken,
      body: { defaultVisibility: 'everyone' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('does not let one user patch another (RLS scopes the update)', async () => {
    const other = await createTestUser('me-victim');
    try {
      const before = await query<{ display_name: string }>(
        `select display_name from public.users where id = $1`,
        [other.id],
      );
      // There is no route to address another user, so the guarantee under test
      // is that the update is scoped to auth.uid() and cannot spill.
      expectOk(
        await callFn<Profile>('me', {
          method: 'PATCH',
          token: user.accessToken,
          body: { displayName: 'Only mine' },
        }),
      );
      const after = await query<{ display_name: string }>(
        `select display_name from public.users where id = $1`,
        [other.id],
      );
      expect(after[0]?.display_name).toBe(before[0]?.display_name);
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

describe('AD-4 — profile timezone never rewrites stored events', () => {
  it('leaves every events row untouched when timezoneId changes', async () => {
    const traveller = await createTestUser('me-tz');
    try {
      const created = expectOk(
        await callFn<Record<string, unknown>>('events', {
          method: 'POST',
          token: traveller.accessToken,
          body: {
            title: 'Morning meeting',
            localStart: '2026-09-07T09:00:00',
            localEnd: '2026-09-07T09:30:00',
            timezoneId: 'America/New_York',
            visibility: 'private',
          },
        }),
        201,
      );

      const before = await query<{ local_start: Date; timezone_id: string; utc_start: Date }>(
        `select local_start, timezone_id, utc_start from public.events where id = $1`,
        [created.id],
      );

      // The user flies to London and updates their profile.
      expectOk(
        await callFn<Profile>('me', {
          method: 'PATCH',
          token: traveller.accessToken,
          body: { timezoneId: 'Europe/London' },
        }),
      );

      const after = await query<{ local_start: Date; timezone_id: string; utc_start: Date }>(
        `select local_start, timezone_id, utc_start from public.events where id = $1`,
        [created.id],
      );

      // A 9am New York meeting stays 9am New York. Rewriting utc_* here would
      // move every appointment the user owns.
      expect(after[0]?.timezone_id).toBe('America/New_York');
      expect(after[0]?.local_start).toEqual(before[0]?.local_start);
      expect(after[0]?.utc_start).toEqual(before[0]?.utc_start);
    } finally {
      await deleteTestUser(traveller.id);
    }
  });

  it("changing an individual event's timezone DOES recompute its utc_*", async () => {
    // The other half of AD-4: the per-event trigger is the legitimate case.
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: {
          title: 'Zone change',
          localStart: '2026-09-07T09:00:00',
          localEnd: '2026-09-07T09:30:00',
          timezoneId: 'America/New_York',
          visibility: 'private',
        },
      }),
      201,
    );
    const before = expectOk(
      await callFn<Record<string, unknown>>(`events/${created.id}`, { token: user.accessToken }),
    );

    const after = expectOk(
      await callFn<Record<string, unknown>>(`events/${created.id}`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { timezoneId: 'Europe/London' },
      }),
    );

    expect(after.localStart).toBe(before.localStart);
    expect(after.utcStart).not.toBe(before.utcStart);
  });
});

describe('GET/PUT /me/notification-preferences', () => {
  it('returns the row handle_new_user created', async () => {
    const prefs = expectOk(
      await callFn<Prefs>('me/notification-preferences', { token: user.accessToken }),
    );
    for (const key of PREFS_REQUIRED) {
      expect(prefs, `missing required property ${key}`).toHaveProperty(key);
    }
    expect(prefs.userId).toBe(user.id);
    expect(prefs.leadTimesMinutes).toEqual([10, 60]);
    expect(prefs.pushEnabled).toBe(true);
  });

  it('replaces preferences and renders quiet hours as HH:mm', async () => {
    const prefs = expectOk(
      await callFn<Prefs>('me/notification-preferences', {
        method: 'PUT',
        token: user.accessToken,
        body: {
          leadTimesMinutes: [5, 30, 1440],
          pushEnabled: true,
          quietHoursStart: '22:00',
          quietHoursEnd: '07:30',
        },
      }),
    );
    expect(prefs.leadTimesMinutes).toEqual([5, 30, 1440]);
    // Postgres `time` renders HH:MM:SS; the contract pattern is ^\d{2}:\d{2}$.
    expect(prefs.quietHoursStart).toBe('22:00');
    expect(prefs.quietHoursEnd).toBe('07:30');
  });

  it('clears quiet hours when both are null', async () => {
    const prefs = expectOk(
      await callFn<Prefs>('me/notification-preferences', {
        method: 'PUT',
        token: user.accessToken,
        body: {
          leadTimesMinutes: [15],
          pushEnabled: false,
          quietHoursStart: null,
          quietHoursEnd: null,
        },
      }),
    );
    expect(prefs.quietHoursStart).toBeNull();
    expect(prefs.quietHoursEnd).toBeNull();
    expect(prefs.pushEnabled).toBe(false);
  });

  it('400s a lead time above the column check constraint, not a 500', async () => {
    // 40320 is the constraint ceiling. Validating before insert keeps this a
    // 400 with a useful message instead of a 23514 mapped to a generic error.
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      body: { leadTimesMinutes: [40321], pushEnabled: true },
    });
    const err = expectErr(res, 400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.message).toMatch(/40320/);
  });

  it('400s a negative lead time', async () => {
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      body: { leadTimesMinutes: [-1], pushEnabled: true },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s duplicate lead times, which would double every reminder', async () => {
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      body: { leadTimesMinutes: [10, 10], pushEnabled: true },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s half a quiet-hours window', async () => {
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      body: { leadTimesMinutes: [10], pushEnabled: true, quietHoursStart: '22:00' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s a malformed quiet-hours value', async () => {
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      body: {
        leadTimesMinutes: [10],
        pushEnabled: true,
        quietHoursStart: '10pm',
        quietHoursEnd: '07:00',
      },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s a missing required field', async () => {
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      body: { leadTimesMinutes: [10] },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it("does not expose another user's preferences", async () => {
    const other = await createTestUser('me-prefs-other');
    try {
      expectOk(
        await callFn<Prefs>('me/notification-preferences', {
          method: 'PUT',
          token: other.accessToken,
          body: { leadTimesMinutes: [99], pushEnabled: true },
        }),
      );
      const mine = expectOk(
        await callFn<Prefs>('me/notification-preferences', { token: user.accessToken }),
      );
      expect(mine.userId).toBe(user.id);
      expect(mine.leadTimesMinutes).not.toEqual([99]);
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it('405s an unsupported verb', async () => {
    const res = await callFn('me/notification-preferences', {
      method: 'DELETE',
      token: user.accessToken,
    });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('malformed request bodies never escape as a bare 500', () => {
  // `await req.json()` succeeds on any valid JSON document, not just an object.
  // A body of literal `null` parsed cleanly and then threw
  // "Cannot use 'in' operator ... in null" out of the handler, producing a 500
  // with no error envelope at all. Found by review; guarded in _shared/body.ts.
  const bodies: Array<[string, string]> = [
    ['null', 'null'],
    ['a bare array', '[]'],
    ['a bare string', '"nope"'],
    ['a bare number', '42'],
    ['a bare boolean', 'true'],
    ['truncated JSON', '{ "title": '],
  ];

  it.each(bodies)('PATCH /me rejects %s with 400', async (_label, raw) => {
    const res = await callFn('me', { method: 'PATCH', token: user.accessToken, rawBody: raw });
    expect(res.status, `got ${res.status}: ${res.text.slice(0, 200)}`).toBe(400);
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it.each(bodies)('PUT /me/notification-preferences rejects %s with 400', async (_label, raw) => {
    const res = await callFn('me/notification-preferences', {
      method: 'PUT',
      token: user.accessToken,
      rawBody: raw,
    });
    expect(res.status, `got ${res.status}: ${res.text.slice(0, 200)}`).toBe(400);
  });

  it.each(bodies)('POST /me/devices rejects %s with 400', async (_label, raw) => {
    const res = await callFn('me/devices', {
      method: 'POST',
      token: user.accessToken,
      rawBody: raw,
    });
    expect(res.status, `got ${res.status}: ${res.text.slice(0, 200)}`).toBe(400);
  });

  it.each(bodies)('POST /events rejects %s with 400', async (_label, raw) => {
    const res = await callFn('events', { method: 'POST', token: user.accessToken, rawBody: raw });
    expect(res.status, `got ${res.status}: ${res.text.slice(0, 200)}`).toBe(400);
  });

  it('DELETE /me/devices/{token} rejects a malformed URL escape without a 500', async () => {
    // decodeURIComponent throws URIError on a bad escape. Kong rejects most of
    // these first, so assert only that it is a 4xx and never a 5xx.
    const res = await callFn('me/devices/abc%zz', { method: 'DELETE', token: user.accessToken });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe('DELETE /me', () => {
  it('405s until T14 lands the SECURITY DEFINER RPC', async () => {
    // Contract defines 202. Deliberately not stubbed: a GDPR deletion endpoint
    // that reports success without deleting is worse than one that is honestly
    // absent. This test flips to expecting 202 when T14 lands.
    const res = await callFn('me', { method: 'DELETE', token: user.accessToken });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});
