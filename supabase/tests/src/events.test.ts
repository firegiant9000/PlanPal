import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callFn,
  createTestUser,
  deleteTestUser,
  eventFixture,
  expectErr,
  expectOk,
  requireLocalStack,
  type TestUser,
} from './harness';

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('events');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('auth gate', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await callFn('events');
    // Kong refuses before the function is reached, so this is the gateway's
    // shape, not our envelope. Asserted so a gateway config change is visible.
    expect(res.status).toBe(401);
  });

  it('rejects the anon key with our own UNAUTHENTICATED envelope', async () => {
    const { ANON_KEY } = await import('./harness');
    const res = await callFn('events', { token: ANON_KEY });
    const err = expectErr(res, 401);
    expect(err.code).toBe('UNAUTHENTICATED');
  });
});

describe('POST /events', () => {
  it('creates a master event', async () => {
    const res = await callFn<Record<string, unknown>>('events', {
      method: 'POST',
      token: user.accessToken,
      body: eventFixture({ title: 'Created by integration test' }),
    });
    const created = expectOk(res, 201);
    expect(created.title).toBe('Created by integration test');
    expect(created.id).toEqual(expect.any(String));
  });

  it('derives utcStart from localStart + timezoneId', async () => {
    const res = await callFn<Record<string, unknown>>('events', {
      method: 'POST',
      token: user.accessToken,
      body: eventFixture({
        localStart: '2026-01-15T09:00:00',
        localEnd: '2026-01-15T10:00:00',
        timezoneId: 'America/New_York',
      }),
    });
    const created = expectOk(res, 201);
    // January in New York is UTC-5, so 09:00 local is 14:00Z.
    expect(String(created.utcStart)).toContain('14:00:00');
  });

  it('rejects a malformed JSON body with 400', async () => {
    const res = await callFn('events', {
      method: 'POST',
      token: user.accessToken,
      rawBody: '{ not json',
    });
    const err = expectErr(res, 400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing required field with 400', async () => {
    const body = eventFixture();
    delete (body as Record<string, unknown>).title;
    const res = await callFn('events', { method: 'POST', token: user.accessToken, body });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('rejects an unparseable RRULE with 400, not a 500', async () => {
    // The P7 minimum set calls this out by name. A bad rule reaching the
    // expander as a runtime throw would surface as INTERNAL_ERROR.
    const res = await callFn('events', {
      method: 'POST',
      token: user.accessToken,
      body: eventFixture({ recurrenceRule: 'FREQ=NONSENSE;BYDAY=??' }),
    });
    const err = expectErr(res, 400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('rejects localEnd before localStart with 400', async () => {
    const res = await callFn('events', {
      method: 'POST',
      token: user.accessToken,
      body: eventFixture({
        localStart: '2026-09-07T10:00:00',
        localEnd: '2026-09-07T09:00:00',
      }),
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /events/{id}', () => {
  it('returns an owned event', async () => {
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: eventFixture({ title: 'Fetch me' }),
      }),
      201,
    );
    const fetched = expectOk(
      await callFn<Record<string, unknown>>(`events/${created.id}`, { token: user.accessToken }),
    );
    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('Fetch me');
  });

  it('404s an unknown id', async () => {
    const res = await callFn('events/8f1b1e2c-0000-4000-8000-00000000dead', {
      token: user.accessToken,
    });
    expect(expectErr(res, 404).code).toBe('NOT_FOUND');
  });

  it('404s a malformed id rather than leaking a database error', async () => {
    const res = await callFn('events/not-a-uuid', { token: user.accessToken });
    expect(expectErr(res, 404).code).toBe('NOT_FOUND');
  });

  it('405s an unsupported verb on a known route', async () => {
    const res = await callFn('events', { method: 'PUT', token: user.accessToken, body: {} });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('cross-user isolation', () => {
  it("does not expose another user's event", async () => {
    const other = await createTestUser('events-other');
    try {
      const theirs = expectOk(
        await callFn<Record<string, unknown>>('events', {
          method: 'POST',
          token: other.accessToken,
          body: eventFixture({ title: 'Private to other user' }),
        }),
        201,
      );

      const res = await callFn(`events/${theirs.id}`, { token: user.accessToken });
      expect(expectErr(res, 404).code).toBe('NOT_FOUND');
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

describe('PATCH /events/{id}', () => {
  it('updates an allowed field', async () => {
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: eventFixture({ title: 'Before' }),
      }),
      201,
    );
    const updated = expectOk(
      await callFn<Record<string, unknown>>(`events/${created.id}`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { title: 'After' },
      }),
    );
    expect(updated.title).toBe('After');
  });

  it('400s when no updatable field is supplied', async () => {
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: eventFixture(),
      }),
      201,
    );
    const res = await callFn(`events/${created.id}`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { notAField: 'x' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /events/{id}', () => {
  it('deletes an owned event and 404s the second time', async () => {
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: eventFixture({ title: 'Delete me' }),
      }),
      201,
    );

    // 202 EmptyResult, per the contract.
    expectOk(
      await callFn(`events/${created.id}`, { method: 'DELETE', token: user.accessToken }),
      202,
    );

    // A delete that matched nothing must be a 404, not a misleading success.
    const again = await callFn(`events/${created.id}`, {
      method: 'DELETE',
      token: user.accessToken,
    });
    expect(expectErr(again, 404).code).toBe('NOT_FOUND');
  });
});

describe('GET /events pagination', () => {
  it('pages with a keyset cursor without repeating or skipping rows', async () => {
    // M2 shipped a version that ordered by created_at while seeking on id,
    // which silently skipped and repeated rows. Create enough events that
    // paging actually has to work.
    const pager = await createTestUser('events-pager');
    try {
      const created: string[] = [];
      for (let i = 0; i < 7; i++) {
        const ev = expectOk(
          await callFn<Record<string, unknown>>('events', {
            method: 'POST',
            token: pager.accessToken,
            body: eventFixture({ title: `Paged ${i}` }),
          }),
          201,
        );
        created.push(String(ev.id));
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const query: Record<string, string> = { limit: '3' };
        if (cursor) query.cursor = cursor;
        const page = expectOk(
          await callFn<{ items: Array<{ id: string }>; nextCursor: string | null }>('events', {
            token: pager.accessToken,
            query,
          }),
        );
        seen.push(...page.items.map((i) => i.id));
        cursor = page.nextCursor;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(created.length);
      expect(new Set(seen).size).toBe(created.length);
      expect([...seen].sort()).toEqual([...created].sort());
    } finally {
      await deleteTestUser(pager.id);
    }
  });

  it('400s a non-positive limit', async () => {
    const res = await callFn('events', { token: user.accessToken, query: { limit: '0' } });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s a cursor that is not an event id', async () => {
    const res = await callFn('events', { token: user.accessToken, query: { cursor: 'nope' } });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });
});
