import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
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

/**
 * The `required` list for a schema, read from `openapi.yaml` at run time.
 *
 * It used to be two hardcoded arrays here — a copy of the contract that
 * nothing kept in step. Adding a required property to the spec regenerates
 * `packages/types`, leaves `contract.yml` green, lets the serializer keep
 * omitting the field, and no test notices. G2's `isBirthday` walked straight
 * through that gap: only the birthday spec caught it, and only because someone
 * happened to write one.
 *
 * `SNAKE_CASE_LEAKS` below stays hardcoded on purpose. It is a denylist of
 * things the spec deliberately does not mention, so it cannot be derived from
 * the spec.
 */
const SPEC_PATH = fileURLToPath(
  // Resolved from this file, not process.cwd(): Vitest's cwd depends on how it
  // was invoked, and a wrong path here would throw rather than fail, which
  // reads as a broken test instead of a contract drift.
  new URL('../../../packages/api-contract/openapi.yaml', import.meta.url),
);

interface OpenApiDocument {
  components?: { schemas?: Record<string, { required?: string[] } | undefined> };
}

let specCache: OpenApiDocument | null = null;

function requiredOf(schema: string): string[] {
  specCache ??= parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;
  const required = specCache.components?.schemas?.[schema]?.required;
  if (!required || required.length === 0) {
    throw new Error(`openapi.yaml declares no required properties for ${schema} (${SPEC_PATH})`);
  }
  return required;
}

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
  'is_birthday',
] as const;

function assertEventShape(event: Record<string, unknown>, where: string) {
  for (const key of requiredOf('Event')) {
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

  it('PATCH /events/{id}/occurrences/{date} returns EventOccurrence, not Event', async () => {
    // The contract declares EventOccurrenceResult here. This route previously
    // returned the raw exception row through the Event serialiser, which forced
    // six required, non-nullable Event properties to null — a sparse exception
    // row is structurally unrepresentable as an Event. This test asserted that
    // Event shape and so had to be flipped with the fix, not after it.
    const master = await create({
      title: 'Shape: override',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });
    const overridden = expectOk(
      await callFn<Record<string, unknown>>(`events/${master.id}/occurrences/2026-09-14`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { title: 'Shape: overridden' },
      }),
    );

    for (const key of requiredOf('EventOccurrence')) {
      expect(
        overridden,
        `override: missing required EventOccurrence property ${key}`,
      ).toHaveProperty(key);
      // Every one of these is non-nullable in the schema. The old response
      // emitted null for most of them, so assert values rather than presence.
      expect(overridden[key], `override: ${key} must not be null`).not.toBeNull();
    }
    for (const key of SNAKE_CASE_LEAKS) {
      expect(overridden, `override: leaked raw column ${key}`).not.toHaveProperty(key);
    }
    // Not an Event: these belong to the master resource, not an occurrence.
    for (const key of ['id', 'ownerId', 'isMaster', 'createdAt', 'updatedAt']) {
      expect(overridden, `override: emitted Event property ${key}`).not.toHaveProperty(key);
    }

    expect(overridden.eventId).toBe(master.id);
    expect(overridden.occurrenceDate).toBe('2026-09-14');
    expect(overridden.title).toBe('Shape: overridden');
    expect(overridden.isException).toBe(true);
    // Unset fields inherit from the master, projected onto the occurrence date.
    expect(overridden.localStart).toBe('2026-09-14T09:00:00');
    expect(overridden.timezoneId).toBe('America/New_York');
    expect(overridden.visibility).toBe('private');
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

describe('the required lists come from the contract, not a copy of it', () => {
  it('reads the required property list from openapi.yaml, not from a copy', () => {
    const event = requiredOf('Event');

    expect(event.length).toBeGreaterThanOrEqual(13);
    expect(event).toContain('isVariableSchedule');
    // `isBirthday` was added to the spec in G2. A hardcoded array written
    // before that would not contain it, so this is what distinguishes a parsed
    // list from a stale copy — and it is the property the old arrays let
    // through undetected.
    expect(event).toContain('isBirthday');

    const occurrence = requiredOf('EventOccurrence');
    expect(occurrence.length).toBeGreaterThanOrEqual(11);
    expect(occurrence).toContain('isVariableSchedule');
  });

  it('fails loudly rather than vacuously when a schema is missing', () => {
    // An empty list would make every shape assertion pass by iterating
    // nothing, which is the exact failure mode this task exists to end.
    expect(() => requiredOf('NoSuchSchema')).toThrow(/no required properties/);
  });
});
