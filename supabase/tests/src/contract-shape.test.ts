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

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('shape');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

describe('POST /events response shape', () => {
  it('currently returns raw snake_case database columns (KNOWN DEFECT)', async () => {
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: eventFixture(),
      }),
      201,
    );

    // This documents what the server does TODAY so the defect is an executable
    // fact rather than a comment. `events/index.ts` maps camelCase -> snake_case
    // on the way IN, then returns the raw row on the way OUT with no inverse
    // mapping. When that is fixed, this assertion should be deleted and the
    // `it.fails` below promoted to a normal test.
    expect(created).toHaveProperty('owner_id');
    expect(created).toHaveProperty('local_start');
    expect(created).toHaveProperty('timezone_id');
    expect(created).toHaveProperty('is_master');
    expect(created).not.toHaveProperty('ownerId');
  });

  // `it.fails` inverts the result: this passes while the bug exists, and starts
  // FAILING the moment the response is fixed — which is the signal to delete the
  // assertion above and make this a plain `it`. It cannot rot silently.
  it.fails('should match the Event schema in openapi.yaml', async () => {
    const created = expectOk(
      await callFn<Record<string, unknown>>('events', {
        method: 'POST',
        token: user.accessToken,
        body: eventFixture(),
      }),
      201,
    );

    for (const key of EVENT_REQUIRED) {
      expect(created, `missing required Event property ${key}`).toHaveProperty(key);
    }
  });
});
