import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expandOccurrences } from './expand.js';
import { RecurrenceRangeError, UnsupportedRRuleError, type EventRecord } from './types.js';

const OWNER = '11111111-1111-1111-1111-111111111111';
const STANDUP = 'aaaaaaaa-0000-0000-0000-000000000002';
const COFFEE = 'aaaaaaaa-0000-0000-0000-000000000001';

function master(over: Partial<EventRecord>): EventRecord {
  return {
    id: STANDUP,
    ownerId: OWNER,
    title: 'Standup',
    description: null,
    location: null,
    localStart: '2026-06-08T09:30:00',
    localEnd: '2026-06-08T09:45:00',
    timezoneId: 'America/New_York',
    isMaster: true,
    masterEventId: null,
    recurrenceExceptionDate: null,
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    isCancelled: false,
    isVariableSchedule: false,
    visibility: 'private',
    colorLabel: null,
    ...over,
  };
}

function exception(over: Partial<EventRecord>): EventRecord {
  return {
    id: 'eeeeeeee-0000-0000-0000-000000000000',
    ownerId: OWNER,
    title: null,
    description: null,
    location: null,
    localStart: null,
    localEnd: null,
    timezoneId: null,
    isMaster: false,
    masterEventId: STANDUP,
    recurrenceExceptionDate: '2026-06-10',
    recurrenceRule: null,
    isCancelled: false,
    isVariableSchedule: false,
    visibility: null,
    colorLabel: null,
    ...over,
  };
}

const standalone: EventRecord = {
  id: COFFEE,
  ownerId: OWNER,
  title: 'Coffee with Scott',
  description: 'Catch-up',
  location: null,
  localStart: '2026-06-10T09:00:00',
  localEnd: '2026-06-10T10:00:00',
  timezoneId: 'America/New_York',
  isMaster: true,
  masterEventId: null,
  recurrenceExceptionDate: null,
  recurrenceRule: null,
  isCancelled: false,
  isVariableSchedule: false,
  visibility: 'shared_all',
  colorLabel: null,
};

test('expands the seed scenario: master + override + cancel + standalone', () => {
  const records = [
    standalone,
    master({}),
    // 06-10 moved later and renamed (THIS override).
    exception({
      recurrenceExceptionDate: '2026-06-10',
      title: 'Standup (moved)',
      localStart: '2026-06-10T10:00:00',
      localEnd: '2026-06-10T10:15:00',
      timezoneId: 'America/New_York',
    }),
    // 06-12 cancelled (THIS-cancel).
    exception({
      id: 'eeeeeeee-0000-0000-0000-000000000001',
      recurrenceExceptionDate: '2026-06-12',
      isCancelled: true,
    }),
  ];

  const out = expandOccurrences(records, { from: '2026-06-08', to: '2026-06-14' });

  // 06-08 standup, 06-10 coffee, 06-10 moved-standup. 06-12 cancelled, 06-14 none.
  assert.equal(out.length, 3);

  // No cancelled occurrence leaks through.
  assert.equal(out.some((o) => o.occurrenceDate === '2026-06-12'), false);

  // Sorted by utcStart: standup 06-08 13:30Z, coffee 06-10 13:00Z, moved 06-10 14:00Z.
  assert.deepEqual(
    out.map((o) => o.utcStart),
    ['2026-06-08T13:30:00Z', '2026-06-10T13:00:00Z', '2026-06-10T14:00:00Z'],
  );

  const base = out[0]!;
  assert.equal(base.eventId, STANDUP);
  assert.equal(base.title, 'Standup');
  assert.equal(base.isException, false);
  assert.equal(base.visibility, 'private');

  const moved = out.find((o) => o.occurrenceDate === '2026-06-10' && o.eventId === STANDUP)!;
  assert.equal(moved.title, 'Standup (moved)');
  assert.equal(moved.isException, true);
  assert.equal(moved.localStart, '2026-06-10T10:00:00');
  assert.equal(moved.localEnd, '2026-06-10T10:15:00');
  assert.equal(moved.visibility, 'private'); // inherited from the master

  const coffee = out.find((o) => o.eventId === COFFEE)!;
  assert.equal(coffee.isException, false);
  assert.equal(coffee.title, 'Coffee with Scott');
});

test('COUNT is evaluated from the series start, not the query window', () => {
  // WEEKLY MO COUNT=2 from 06-08 -> occurrences 06-08 (#1) and 06-15 (#2) only.
  const records = [master({ recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=2' })];
  const out = expandOccurrences(records, { from: '2026-06-15', to: '2026-06-30' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.occurrenceDate, '2026-06-15');
});

test('variable-schedule masters are not expanded', () => {
  const records = [master({ isVariableSchedule: true })];
  assert.equal(expandOccurrences(records, { from: '2026-06-08', to: '2026-06-30' }).length, 0);
});

test('an override does not change the occurrence date key', () => {
  const records = [
    master({}),
    exception({
      recurrenceExceptionDate: '2026-06-10',
      localStart: '2026-06-11T08:00:00', // moved to the next day...
      localEnd: '2026-06-11T08:30:00',
      timezoneId: 'America/New_York',
    }),
  ];
  const out = expandOccurrences(records, { from: '2026-06-10', to: '2026-06-10' });
  const moved = out.find((o) => o.eventId === STANDUP)!;
  assert.equal(moved.occurrenceDate, '2026-06-10'); // series date, not the moved date
  assert.equal(moved.localStart, '2026-06-11T08:00:00');
});

test('range validation rejects reversed and oversized windows', () => {
  assert.throws(() => expandOccurrences([], { from: '2026-06-10', to: '2026-06-08' }), RecurrenceRangeError);
  assert.throws(() => expandOccurrences([], { from: '2026-01-01', to: '2026-12-31' }), RecurrenceRangeError);
  assert.throws(() => expandOccurrences([], { from: 'bad', to: '2026-06-08' }), RecurrenceRangeError);
});

test('an unsupported RRULE surfaces loudly rather than dropping the event', () => {
  const records = [master({ recurrenceRule: 'FREQ=DAILY;BYYEARDAY=1' })];
  assert.throws(() => expandOccurrences(records, { from: '2026-06-08', to: '2026-06-30' }), UnsupportedRRuleError);
});

test('UTC is derived per-occurrence across a DST boundary; local time-of-day holds', () => {
  // Daily 09:30 NY across the 2026-03-08 spring-forward. The wall-clock start is
  // constant (09:30) but utcStart shifts 14:30Z (EST) -> 13:30Z (EDT) at the
  // transition — the whole reason UTC is computed per occurrence, not on the master.
  const records = [
    master({
      localStart: '2026-03-07T09:30:00',
      localEnd: '2026-03-07T09:45:00',
      recurrenceRule: 'FREQ=DAILY',
    }),
  ];
  const out = expandOccurrences(records, { from: '2026-03-07', to: '2026-03-09' });
  assert.deepEqual(
    out.map((o) => ({ date: o.occurrenceDate, local: o.localStart, utc: o.utcStart })),
    [
      { date: '2026-03-07', local: '2026-03-07T09:30:00', utc: '2026-03-07T14:30:00Z' }, // EST
      { date: '2026-03-08', local: '2026-03-08T09:30:00', utc: '2026-03-08T13:30:00Z' }, // EDT
      { date: '2026-03-09', local: '2026-03-09T09:30:00', utc: '2026-03-09T13:30:00Z' }, // EDT
    ],
  );
});

test('a daily series spans a leap day correctly', () => {
  // 2028 is a leap year: Feb 28 -> Feb 29 -> Mar 1 must all appear, in order.
  const records = [
    master({
      localStart: '2028-02-28T09:30:00',
      localEnd: '2028-02-28T09:45:00',
      recurrenceRule: 'FREQ=DAILY',
    }),
  ];
  const out = expandOccurrences(records, { from: '2028-02-28', to: '2028-03-01' });
  assert.deepEqual(
    out.map((o) => o.occurrenceDate),
    ['2028-02-28', '2028-02-29', '2028-03-01'],
  );
});

test('a standalone event applies its override (times and title)', () => {
  // Regression: overrides were only applied to recurring masters, so a THIS
  // override on a one-off event was stored but silently ignored by expansion.
  const records = [
    standalone,
    exception({
      masterEventId: COFFEE,
      recurrenceExceptionDate: '2026-06-10',
      title: 'Coffee (moved)',
      localStart: '2026-06-10T18:00:00',
      localEnd: '2026-06-10T19:00:00',
    }),
  ];
  const out = expandOccurrences(records, { from: '2026-06-08', to: '2026-06-14' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.title, 'Coffee (moved)');
  assert.equal(out[0]!.localStart, '2026-06-10T18:00:00');
  assert.equal(out[0]!.localEnd, '2026-06-10T19:00:00');
  assert.equal(out[0]!.isException, true);
});

test('a standalone event honours a THIS-cancel', () => {
  const records = [
    standalone,
    exception({
      masterEventId: COFFEE,
      recurrenceExceptionDate: '2026-06-10',
      isCancelled: true,
    }),
  ];
  assert.equal(expandOccurrences(records, { from: '2026-06-08', to: '2026-06-14' }).length, 0);
});

test('a variable-schedule master emits its filled-in weeks (non-cancelled exceptions)', () => {
  // Regression: the engine skipped variable masters entirely, and the
  // /occurrences placeholder pass skips overridden dates — so a week the user
  // had filled in vanished from the calendar altogether.
  const records = [
    master({ isVariableSchedule: true, recurrenceRule: null }),
    exception({
      recurrenceExceptionDate: '2026-06-17',
      localStart: '2026-06-17T13:00:00',
      localEnd: '2026-06-17T15:00:00',
    }),
    exception({
      id: 'eeeeeeee-0000-0000-0000-000000000002',
      recurrenceExceptionDate: '2026-06-24',
      isCancelled: true,
    }),
    // Outside the window: must not leak in.
    exception({
      id: 'eeeeeeee-0000-0000-0000-000000000003',
      recurrenceExceptionDate: '2026-07-08',
      localStart: '2026-07-08T13:00:00',
      localEnd: '2026-07-08T15:00:00',
    }),
  ];
  const out = expandOccurrences(records, { from: '2026-06-08', to: '2026-06-30' });
  assert.equal(out.length, 1);
  assert.equal(out[0]!.occurrenceDate, '2026-06-17');
  assert.equal(out[0]!.localStart, '2026-06-17T13:00:00');
  assert.equal(out[0]!.localEnd, '2026-06-17T15:00:00');
  assert.equal(out[0]!.title, 'Standup'); // inherited from the master
  assert.equal(out[0]!.isException, true);
});

test('a variable-schedule master with no exceptions still expands to nothing', () => {
  const records = [master({ isVariableSchedule: true, recurrenceRule: null })];
  assert.equal(expandOccurrences(records, { from: '2026-06-08', to: '2026-06-30' }).length, 0);
});

test('a title-only override on a variable master does not invent times', () => {
  // A variable master's localStart is a placeholder the engine must never
  // present as a real time. An override that supplies no concrete times leaves
  // the week un-entered, so the engine must not emit a timed occurrence for it.
  const records = [
    master({ isVariableSchedule: true, recurrenceRule: null }),
    exception({ recurrenceExceptionDate: '2026-06-17', title: 'Renamed shift' }),
  ];
  const out = expandOccurrences(records, { from: '2026-06-08', to: '2026-06-30' });
  assert.equal(out.length, 0);
});
