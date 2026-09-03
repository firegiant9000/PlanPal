import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callFn,
  createTestUser,
  deleteTestUser,
  eventFixture,
  expectOk,
  requireLocalStack,
  type TestUser,
} from './harness';

/**
 * Does the wire format match `openapi.yaml`?
 *
 * `packages/types` is generated from that spec, so anything a client reads
 * through the generated `Event` model is `undefined` wherever the two disagree
 * — with no type error, because the client believes the generated type.
 *
 * This suite found exactly that: `events/index.ts` mapped camelCase to
 * snake_case on the way in and returned the raw PostgREST row on the way out,
 * so not one of the thirteen required `Event` properties was present.
 * `_shared/serialize.ts` is the missing inverse; these tests hold it in place.
 */

/** Required properties of `Event` in openapi.yaml. */
const EVENT_REQUIRED = [
  'id',
  'ownerId',
  'title',
  'localStart',
  'localEnd',
  'timezoneId',
  'utcStart',
  'utcEnd',
  'isMaster',
  'visibility',
  'isVariableSchedule',
  'createdAt',
  'updatedAt',
] as const;

/** Column names that must never appear on the wire. */
const SNAKE_CASE_LEAKS = [
  'owner_id',
  'local_start',
  'local_end',
  'timezone_id',
  'utc_start',
  'utc_end',
  'is_master',
  'is_variable_schedule',
  'color_label',
  'shared_with',
  'created_at',
  'updated_at',
  'master_event_id',
  'recurrence_rule',
  'recurrence_exception_date',
  'is_cancelled',
] as const;

function assertEventShape(event: Record<string, unknown>, where: string) {
  for (const key of EVENT_REQUIRED) {
    expect(event, `${where}: missing required Event property ${key}`).toHaveProperty(key);
  }
  for (const key of SNAKE_CASE_LEAKS) {
    expect(event, `${where}: leaked raw column ${key}`).not.toHaveProperty(key);
  }
}

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('shape');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

async function create(overrides: Record<string, unknown> = {}) {
  return expectOk(
    await callFn<Record<string, unknown>>('events', {
      method: 'POST',
      token: user.accessToken,
      body: eventFixture(overrides),
    }),
    201,
  );
}

describe('Event responses match the contract', () => {
  it('POST /events', async () => {
    assertEventShape(await create(), 'POST /events');
  });

  it('GET /events/{id}', async () => {
    const created = await create({ title: 'Shape: get' });
    const fetched = expectOk(
      await callFn<Record<string, unknown>>(`events/${created.id}`, { token: user.accessToken }),
    );
    assertEventShape(fetched, 'GET /events/{id}');
  });

  it('PATCH /events/{id}', async () => {
    const created = await create({ title: 'Shape: patch' });
    const updated = expectOk(
      await callFn<Record<string, unknown>>(`events/${created.id}`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { title: 'Shape: patched' },
      }),
    );
    assertEventShape(updated, 'PATCH /events/{id}');
  });

  it('GET /events list items', async () => {
    await create({ title: 'Shape: list' });
    const page = expectOk(
      await callFn<{ items: Array<Record<string, unknown>>; nextCursor: string | null }>('events', {
        token: user.accessToken,
        query: { limit: '5' },
      }),
    );
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items) assertEventShape(item, 'GET /events item');
  });

  it('PUT /events/{id}/occurrences/{date}', async () => {
    const master = await create({
      title: 'Shape: override',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const overridden = expectOk(
      await callFn<Record<string, unknown>>(`events/${master.id}/occurrences/2026-09-14`, {
        method: 'PUT',
        token: user.accessToken,
        body: { title: 'Shape: overridden' },
      }),
    );
    assertEventShape(overridden, 'PUT occurrence override');
  });

  it('carries values through the mapping, not just the keys', async () => {
    // A mapper that returns the right keys with the wrong values would satisfy
    // a pure shape check. Pin the values that actually matter.
    const created = await create({
      title: 'Shape: values',
      localStart: '2026-01-15T09:00:00',
      localEnd: '2026-01-15T10:00:00',
      timezoneId: 'America/New_York',
    });

    expect(created.ownerId).toBe(user.id);
    expect(created.title).toBe('Shape: values');
    expect(created.localStart).toBe('2026-01-15T09:00:00');
    expect(created.timezoneId).toBe('America/New_York');
    expect(created.isMaster).toBe(true);
    expect(created.isVariableSchedule).toBe(false);
    expect(created.visibility).toBe('private');
    expect(created.sharedWith).toEqual([]);
    // January in New York is UTC-5, so 09:00 local is 14:00Z.
    expect(String(created.utcStart)).toContain('14:00:00');
    expect(created.createdAt).toEqual(expect.any(String));
    expect(created.updatedAt).toEqual(expect.any(String));
  });
});
