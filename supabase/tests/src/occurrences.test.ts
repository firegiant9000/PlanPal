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

interface Occurrence {
  eventId: string;
  occurrenceDate: string;
  title: string;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  utcStart: string;
  utcEnd: string;
  visibility: string;
  isException: boolean;
  isVariableSchedule: boolean;
}

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('occ');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

async function createMaster(overrides: Record<string, unknown> = {}) {
  return expectOk(
    await callFn<Record<string, unknown>>('events', {
      method: 'POST',
      token: user.accessToken,
      body: eventFixture(overrides),
    }),
    201,
  );
}

async function range(from: string, to: string) {
  return expectOk(
    await callFn<{ items: Occurrence[] }>('occurrences', {
      token: user.accessToken,
      query: { from, to },
    }),
  ).items;
}

describe('GET /occurrences', () => {
  it('expands a weekly master across the range', async () => {
    const master = await createMaster({
      title: 'Weekly expansion',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    const items = (await range('2026-09-01', '2026-09-30')).filter((o) => o.eventId === master.id);

    // Mondays in September 2026: 7, 14, 21, 28.
    expect(items.map((o) => o.occurrenceDate)).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ]);
    expect(items.every((o) => o.isException === false)).toBe(true);
  });

  it('returns the occurrence shape the contract defines', async () => {
    const master = await createMaster({ title: 'Shape check' });
    const [occ] = (await range('2026-09-01', '2026-09-30')).filter((o) => o.eventId === master.id);

    // camelCase, per `EventOccurrence` in openapi.yaml. `isVariableSchedule`
    // became part of that schema in T9 and is required, so its absence here
    // would be a contract regression rather than a missing optional.
    for (const key of [
      'eventId',
      'occurrenceDate',
      'title',
      'localStart',
      'localEnd',
      'timezoneId',
      'utcStart',
      'utcEnd',
      'visibility',
      'isException',
      'isVariableSchedule',
    ]) {
      expect(occ, `missing contract property ${key}`).toHaveProperty(key);
    }
  });

  it('400s a missing range', async () => {
    const res = await callFn('occurrences', { token: user.accessToken });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s an inverted range', async () => {
    const res = await callFn('occurrences', {
      token: user.accessToken,
      query: { from: '2026-09-30', to: '2026-09-01' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });
});

describe('occurrence override (PATCH) and cancel (DELETE)', () => {
  it('overrides a single occurrence, leaving its siblings untouched', async () => {
    const master = await createMaster({
      title: 'Override series',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    // This is the call that failed at runtime for the whole of M2: PostgREST
    // upserts onto `events_one_exception_per_date`, which was a PARTIAL unique
    // index and so could never be inferred as an ON CONFLICT target.
    expectOk(
      await callFn(`events/${master.id}/occurrences/2026-09-14`, {
        method: 'PATCH',
        token: user.accessToken,
        body: {
          title: 'Moved standup',
          localStart: '2026-09-14T11:00:00',
          localEnd: '2026-09-14T11:30:00',
        },
      }),
    );

    const items = (await range('2026-09-01', '2026-09-30')).filter((o) => o.eventId === master.id);
    const overridden = items.find((o) => o.occurrenceDate === '2026-09-14');
    const sibling = items.find((o) => o.occurrenceDate === '2026-09-21');

    expect(overridden?.title).toBe('Moved standup');
    expect(overridden?.isException).toBe(true);
    expect(overridden?.localStart).toContain('11:00');

    expect(sibling?.title).toBe('Override series');
    expect(sibling?.isException).toBe(false);
  });

  it('is idempotent — overriding the same date twice updates rather than erroring', async () => {
    const master = await createMaster({
      title: 'Twice series',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    for (const title of ['First override', 'Second override']) {
      expectOk(
        await callFn(`events/${master.id}/occurrences/2026-09-14`, {
          method: 'PATCH',
          token: user.accessToken,
          body: { title },
        }),
      );
    }

    const items = (await range('2026-09-01', '2026-09-30')).filter((o) => o.eventId === master.id);
    const overridden = items.filter((o) => o.occurrenceDate === '2026-09-14');

    // One row, not two: the unique index must hold and the upsert must update.
    expect(overridden).toHaveLength(1);
    expect(overridden[0]?.title).toBe('Second override');
  });

  it('cancels a single occurrence and removes only that one', async () => {
    const master = await createMaster({
      title: 'Cancel series',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    expectOk(
      await callFn(`events/${master.id}/occurrences/2026-09-21`, {
        method: 'DELETE',
        token: user.accessToken,
      }),
      202,
    );

    const dates = (await range('2026-09-01', '2026-09-30'))
      .filter((o) => o.eventId === master.id)
      .map((o) => o.occurrenceDate);

    expect(dates).not.toContain('2026-09-21');
    expect(dates).toEqual(['2026-09-07', '2026-09-14', '2026-09-28']);
  });

  it('404s an override against an event the caller does not own', async () => {
    const other = await createTestUser('occ-other');
    try {
      const theirs = expectOk(
        await callFn<Record<string, unknown>>('events', {
          method: 'POST',
          token: other.accessToken,
          body: eventFixture({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' }),
        }),
        201,
      );
      const res = await callFn(`events/${theirs.id}/occurrences/2026-09-14`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { title: 'Should not work' },
      });
      expect(expectErr(res, 404).code).toBe('NOT_FOUND');
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it('400s a malformed occurrence date', async () => {
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    const res = await callFn(`events/${master.id}/occurrences/14-09-2026`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { title: 'Nope' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('400s the occurrences sub-path with no date instead of falling through', async () => {
    // Regression: `DELETE /events/{id}/occurrences` (date missing) previously
    // fell through to the single-event branch and deleted the entire master.
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    const res = await callFn(`events/${master.id}/occurrences`, {
      method: 'DELETE',
      token: user.accessToken,
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');

    const after = await callFn(`events/${master.id}`, { token: user.accessToken });
    expect(after.status, 'the master must survive a dateless occurrence call').toBe(200);
  });

  it('404s an override for a date the series never generates', async () => {
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    const res = await callFn(`events/${master.id}/occurrences/2026-09-16`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { title: 'Not a Monday' },
    });
    expect(expectErr(res, 404).code).toBe('NOT_FOUND');
  });

  it('applies an override to a standalone (non-recurring) event', async () => {
    // Regression: the engine only applied exceptions to recurring masters, so a
    // standalone override returned 200 and then never appeared in /occurrences.
    const master = await createMaster({ title: 'One-off', recurrenceRule: null });
    expectOk(
      await callFn(`events/${master.id}/occurrences/2026-09-07`, {
        method: 'PATCH',
        token: user.accessToken,
        body: {
          title: 'One-off (moved)',
          localStart: '2026-09-07T18:00:00',
          localEnd: '2026-09-07T19:00:00',
        },
      }),
    );

    const items = (await range('2026-09-01', '2026-09-30')).filter((o) => o.eventId === master.id);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('One-off (moved)');
    expect(items[0]?.localStart).toBe('2026-09-07T18:00:00');
    expect(items[0]?.isException).toBe(true);
  });

  it('keeps a filled-in variable-schedule week on the calendar', async () => {
    // Regression: filling in a week suppressed that week's placeholder AND the
    // engine skipped the exception, so the occurrence vanished entirely.
    const master = await createMaster({
      title: 'Var shift',
      isVariableSchedule: true,
      recurrenceRule: null,
    });
    expectOk(
      await callFn(`events/${master.id}/occurrences/2026-09-14`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { localStart: '2026-09-14T13:00:00', localEnd: '2026-09-14T15:00:00' },
      }),
    );

    const items = (await range('2026-09-01', '2026-09-30')).filter((o) => o.eventId === master.id);
    const filled = items.find((o) => o.occurrenceDate === '2026-09-14');
    expect(filled, 'the filled-in week must not vanish').toBeDefined();
    expect(filled?.localStart).toBe('2026-09-14T13:00:00');
    expect(filled?.isVariableSchedule).toBe(false);
    // The other weeks stay as placeholders.
    expect(items.some((o) => o.occurrenceDate === '2026-09-21' && o.isVariableSchedule)).toBe(true);
  });

  it('merges consecutive overrides instead of resetting unmentioned fields', async () => {
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    expectOk(
      await callFn(`events/${master.id}/occurrences/2026-09-14`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { localStart: '2026-09-14T11:00:00', localEnd: '2026-09-14T11:30:00' },
      }),
    );
    const second = expectOk<{ title: string; localStart: string }>(
      await callFn(`events/${master.id}/occurrences/2026-09-14`, {
        method: 'PATCH',
        token: user.accessToken,
        body: { title: 'Renamed only' },
      }),
    );
    // PATCH semantics: the earlier time override must survive a later
    // title-only override.
    expect(second.title).toBe('Renamed only');
    expect(second.localStart).toBe('2026-09-14T11:00:00');
  });

  it('rejects undeclared override fields and an empty body', async () => {
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    const unknown = await callFn(`events/${master.id}/occurrences/2026-09-14`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { timezoneId: 'Europe/London' },
    });
    expect(expectErr(unknown, 400).code).toBe('VALIDATION_ERROR');

    const empty = await callFn(`events/${master.id}/occurrences/2026-09-14`, {
      method: 'PATCH',
      token: user.accessToken,
      body: {},
    });
    expect(expectErr(empty, 400).code).toBe('VALIDATION_ERROR');
  });

  it('rejects a merged override that would end before it starts', async () => {
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    // localEnd alone is well-formed, but lands before the master's projected
    // 09:00 start for that date — the merged occurrence would be inverted.
    const res = await callFn(`events/${master.id}/occurrences/2026-09-14`, {
      method: 'PATCH',
      token: user.accessToken,
      body: { localEnd: '2026-09-14T08:00:00' },
    });
    expect(expectErr(res, 400).code).toBe('VALIDATION_ERROR');
  });

  it('405s PUT on the override route (the contract declares PATCH)', async () => {
    const master = await createMaster({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO' });
    const res = await callFn(`events/${master.id}/occurrences/2026-09-14`, {
      method: 'PUT',
      token: user.accessToken,
      body: { title: 'Nope' },
    });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});
