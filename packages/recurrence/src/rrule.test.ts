import assert from 'node:assert/strict';
import { test } from 'node:test';
import { civilMidnightMs, occurrenceDates, parseRRule } from './rrule.js';
import { UnsupportedRRuleError } from './types.js';

// 2026-06-08 is a Monday (2026-06-07 is a Sunday).
const MON_2026_06_08 = civilMidnightMs(2026, 6, 8);
const pad = (n: number): string => String(n).padStart(2, '0');
const dateOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const datesOf = (rule: string, startMs: number, toMs: number): string[] =>
  [...occurrenceDates(parseRRule(rule), startMs, toMs)].map(dateOf);

test('parseRRule reads the kickoff subset', () => {
  const rule = parseRRule('FREQ=WEEKLY;BYDAY=MO,WE,FR;INTERVAL=1');
  assert.equal(rule.freq, 'WEEKLY');
  assert.equal(rule.interval, 1);
  assert.deepEqual(rule.byday, [1, 3, 5]);
  assert.equal(rule.count, null);
  assert.equal(rule.untilMs, null);
});

test('WEEKLY BYDAY expands to the matching weekdays in order', () => {
  assert.deepEqual(
    datesOf('FREQ=WEEKLY;BYDAY=MO,WE,FR', MON_2026_06_08, civilMidnightMs(2026, 6, 19)),
    ['2026-06-08', '2026-06-10', '2026-06-12', '2026-06-15', '2026-06-17', '2026-06-19'],
  );
});

test('WEEKLY INTERVAL=2 skips alternate weeks (bi-weekly)', () => {
  assert.deepEqual(
    datesOf('FREQ=WEEKLY;BYDAY=MO;INTERVAL=2', MON_2026_06_08, civilMidnightMs(2026, 7, 6)),
    ['2026-06-08', '2026-06-22', '2026-07-06'],
  );
});

test('WEEKLY with no BYDAY uses the start weekday', () => {
  assert.deepEqual(
    datesOf('FREQ=WEEKLY', MON_2026_06_08, civilMidnightMs(2026, 6, 30)),
    ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'],
  );
});

test('DAILY with COUNT stops after COUNT occurrences', () => {
  assert.deepEqual(
    datesOf('FREQ=DAILY;COUNT=3', MON_2026_06_08, civilMidnightMs(2026, 12, 31)),
    ['2026-06-08', '2026-06-09', '2026-06-10'],
  );
});

test('DAILY INTERVAL respects the step', () => {
  assert.deepEqual(
    datesOf('FREQ=DAILY;INTERVAL=2;COUNT=3', MON_2026_06_08, civilMidnightMs(2026, 12, 31)),
    ['2026-06-08', '2026-06-10', '2026-06-12'],
  );
});

test('UNTIL (date-only) is inclusive of the whole day', () => {
  assert.deepEqual(
    datesOf('FREQ=DAILY;UNTIL=20260610', MON_2026_06_08, civilMidnightMs(2026, 12, 31)),
    ['2026-06-08', '2026-06-09', '2026-06-10'],
  );
});

test('parseRRule rejects out-of-subset and contradictory rules', () => {
  assert.throws(() => parseRRule('FREQ=MONTHLY'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=YEARLY'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYMONTHDAY=1'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;WKST=SU'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=DAILY;COUNT=2;UNTIL=20260610'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYDAY=2MO'), UnsupportedRRuleError);
});
