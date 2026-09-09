import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRRule, civilMidnightMs, occurrenceDates, parseRRule } from './rrule.js';
import { UnsupportedRRuleError } from './types.js';

// 2026-06-08 is a Monday.
const MON_2026_06_08 = civilMidnightMs(2026, 6, 8);
const pad = (n: number): string => String(n).padStart(2, '0');
const dateOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const datesOf = (rule: string, startMs: number, toMs: number): string[] =>
  [...occurrenceDates(parseRRule(rule), startMs, toMs)].map(dateOf);

// ---------------------------------------------------------------------------
// DAILY
// ---------------------------------------------------------------------------
test('DAILY COUNT stops after COUNT occurrences', () => {
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

// ---------------------------------------------------------------------------
// WEEKLY
// ---------------------------------------------------------------------------
test('WEEKLY BYDAY expands to the matching weekdays', () => {
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

test('WEEKLY WKST=SU shifts bi-weekly week boundaries', () => {
  // Starting Thursday 2026-06-11; bi-weekly, WKST=SU.
  // Week containing 06-11 (Sun-Sat): 06-07 Sun – 06-13 Sat → active.
  // Skip week 06-14 Sun – 06-20 Sat → next active: 06-21 Sun – 06-27 Sat → 06-25 TH.
  const THU_2026_06_11 = civilMidnightMs(2026, 6, 11);
  assert.deepEqual(
    datesOf('FREQ=WEEKLY;BYDAY=TH;INTERVAL=2;WKST=SU', THU_2026_06_11, civilMidnightMs(2026, 7, 15)),
    ['2026-06-11', '2026-06-25', '2026-07-09'],
  );
});

// ---------------------------------------------------------------------------
// MONTHLY — default (same day-of-month as DTSTART)
// ---------------------------------------------------------------------------
test('MONTHLY default repeats on the same day each month', () => {
  const JAN_15 = civilMidnightMs(2026, 1, 15);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY', JAN_15, civilMidnightMs(2026, 4, 30)),
    ['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'],
  );
});

test('MONTHLY clamps to last day when month is shorter (Jan-31 → Feb-28)', () => {
  const JAN_31 = civilMidnightMs(2026, 1, 31);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;COUNT=3', JAN_31, civilMidnightMs(2026, 12, 31)),
    ['2026-01-31', '2026-02-28', '2026-03-31'],
  );
});

test('MONTHLY BYMONTHDAY=1 repeats on the 1st of every month', () => {
  const FEB_1 = civilMidnightMs(2026, 2, 1);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYMONTHDAY=1;COUNT=3', FEB_1, civilMidnightMs(2026, 12, 31)),
    ['2026-02-01', '2026-03-01', '2026-04-01'],
  );
});

test('MONTHLY BYMONTHDAY=-1 resolves to last day of month', () => {
  const FEB_28 = civilMidnightMs(2026, 2, 28);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3', FEB_28, civilMidnightMs(2026, 12, 31)),
    ['2026-02-28', '2026-03-31', '2026-04-30'],
  );
});

test('MONTHLY BYDAY=1MO is the first Monday of each month', () => {
  const JAN_5 = civilMidnightMs(2026, 1, 5); // first Monday of Jan 2026
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYDAY=1MO;COUNT=3', JAN_5, civilMidnightMs(2026, 12, 31)),
    ['2026-01-05', '2026-02-02', '2026-03-02'],
  );
});

test('MONTHLY BYDAY=-1FR is the last Friday of each month', () => {
  // Last Friday of Jan 2026 = Jan 30.
  const JAN_30 = civilMidnightMs(2026, 1, 30);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYDAY=-1FR;COUNT=3', JAN_30, civilMidnightMs(2026, 12, 31)),
    ['2026-01-30', '2026-02-27', '2026-03-27'],
  );
});

test('MONTHLY BYDAY without ordinal = every occurrence of those weekdays in the month', () => {
  // Every Monday in January 2026: 5, 12, 19, 26.
  const JAN_5 = civilMidnightMs(2026, 1, 5);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYDAY=MO;COUNT=4', JAN_5, civilMidnightMs(2026, 1, 31)),
    ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'],
  );
});

test('MONTHLY BYSETPOS=1 with BYDAY=MO,FR picks the first weekday hit in the month', () => {
  // In Jan 2026: first MO=5, first FR=2 → sorted candidates [2, 5] → BYSETPOS=1 → Jan 2.
  const JAN_2 = civilMidnightMs(2026, 1, 2);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYDAY=MO,FR;BYSETPOS=1;COUNT=1', JAN_2, civilMidnightMs(2026, 1, 31)),
    ['2026-01-02'],
  );
});

test('MONTHLY BYSETPOS=-1 picks the last match', () => {
  // Every MO in Jan 2026: [5,12,19,26] → BYSETPOS=-1 → Jan 26.
  const JAN_5 = civilMidnightMs(2026, 1, 5);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYDAY=MO;BYSETPOS=-1;COUNT=1', JAN_5, civilMidnightMs(2026, 1, 31)),
    ['2026-01-26'],
  );
});

test('MONTHLY INTERVAL=3 repeats quarterly', () => {
  const JAN_1 = civilMidnightMs(2026, 1, 1);
  assert.deepEqual(
    datesOf('FREQ=MONTHLY;BYMONTHDAY=1;INTERVAL=3;COUNT=4', JAN_1, civilMidnightMs(2027, 12, 31)),
    ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01'],
  );
});

// ---------------------------------------------------------------------------
// YEARLY
// ---------------------------------------------------------------------------
test('YEARLY default repeats on the same month+day each year', () => {
  const JUN_15 = civilMidnightMs(2026, 6, 15);
  assert.deepEqual(
    datesOf('FREQ=YEARLY;COUNT=3', JUN_15, civilMidnightMs(2030, 12, 31)),
    ['2026-06-15', '2027-06-15', '2028-06-15'],
  );
});

test('YEARLY BYMONTH=12;BYMONTHDAY=25 is Christmas every year', () => {
  const DEC_25_2026 = civilMidnightMs(2026, 12, 25);
  assert.deepEqual(
    datesOf('FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25;COUNT=3', DEC_25_2026, civilMidnightMs(2030, 12, 31)),
    ['2026-12-25', '2027-12-25', '2028-12-25'],
  );
});

test('YEARLY BYMONTH=11;BYDAY=4TH is US Thanksgiving (4th Thursday of November)', () => {
  // Thanksgiving 2026 = Nov 26; 2027 = Nov 25; 2028 = Nov 23.
  const NOV_26_2026 = civilMidnightMs(2026, 11, 26);
  assert.deepEqual(
    datesOf('FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;COUNT=3', NOV_26_2026, civilMidnightMs(2030, 12, 31)),
    ['2026-11-26', '2027-11-25', '2028-11-23'],
  );
});

test('YEARLY birthday on Feb 29 falls back to Feb 28 in non-leap years', () => {
  // 2028 is a leap year; 2029, 2030 are not.
  const FEB_29_2028 = civilMidnightMs(2028, 2, 29);
  assert.deepEqual(
    datesOf('FREQ=YEARLY;COUNT=3', FEB_29_2028, civilMidnightMs(2031, 12, 31)),
    ['2028-02-29', '2029-02-28', '2030-02-28'],
  );
});

test('YEARLY INTERVAL=2 fires every other year', () => {
  const JAN_1_2026 = civilMidnightMs(2026, 1, 1);
  assert.deepEqual(
    datesOf('FREQ=YEARLY;BYMONTHDAY=1;BYMONTH=1;INTERVAL=2;COUNT=3', JAN_1_2026, civilMidnightMs(2032, 12, 31)),
    ['2026-01-01', '2028-01-01', '2030-01-01'],
  );
});

// ---------------------------------------------------------------------------
// parseRRule validation
// ---------------------------------------------------------------------------
test('parseRRule reads a complete rule correctly', () => {
  const rule = parseRRule('FREQ=MONTHLY;BYDAY=2MO;INTERVAL=1');
  assert.equal(rule.freq, 'MONTHLY');
  assert.equal(rule.byday.length, 1);
  assert.equal(rule.byday[0]!.ordinal, 2);
  assert.equal(rule.byday[0]!.weekday, 1);
  assert.equal(rule.interval, 1);
});

test('parseRRule rejects unsupported rules', () => {
  assert.throws(() => parseRRule('FREQ=HOURLY'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYYEARDAY=1'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYWEEKNO=1'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYMONTHDAY=1'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=WEEKLY;BYMONTH=1'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=DAILY;COUNT=2;UNTIL=20260610'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=MONTHLY;BYSETPOS=0'), UnsupportedRRuleError);
  assert.throws(() => parseRRule('FREQ=MONTHLY;BYDAY=0MO'), UnsupportedRRuleError);
});

test('COUNT is evaluated from series start, not the query window', () => {
  // WEEKLY MO COUNT=2 from 06-08 → only 06-08 (#1) and 06-15 (#2).
  // Window starts at 06-15 so only the 2nd occurrence is in window.
  const records_like = datesOf('FREQ=WEEKLY;BYDAY=MO;COUNT=2', MON_2026_06_08, civilMidnightMs(2026, 6, 30));
  assert.deepEqual(records_like, ['2026-06-08', '2026-06-15']);
  // Window restricted to [06-15, 06-30] — generator still returns only 06-15.
  const windowed = datesOf('FREQ=WEEKLY;BYDAY=MO;COUNT=2', MON_2026_06_08, civilMidnightMs(2026, 6, 30));
  assert.equal(windowed.filter((d) => d >= '2026-06-15').length, 1);
});

// ---------------------------------------------------------------------------
// buildRRule — moved here from apps/mobile's event form (T28).
//
// RRULE construction belongs beside the parser. While it lived in the mobile
// form, web growing its own event form meant a second implementation, and the
// two would have drifted silently: nothing compares them.
// ---------------------------------------------------------------------------
test('builds a weekly BYDAY rule from a form selection', () => {
  assert.equal(
    buildRRule({ repeat: 'weekly', byDay: ['MO', 'WE'], endRepeat: 'never' }),
    'FREQ=WEEKLY;BYDAY=MO,WE',
  );
});

test('round-trips every rule it builds through the parser', () => {
  // The assertion that makes the move safe: anything the form can construct
  // must be something the engine accepts. A builder that emits a rule the
  // parser rejects fails at event-creation time, in front of the user.
  const repeats = ['daily', 'weekly', 'biweekly', 'monthly', 'yearly'] as const;
  const endings = [
    { endRepeat: 'never' as const },
    { endRepeat: 'ondate' as const, endDate: '2026-12-31' },
    { endRepeat: 'aftercount' as const, count: '5' },
  ];

  let checked = 0;
  for (const repeat of repeats) {
    for (const ending of endings) {
      for (const byDay of [undefined, ['MO', 'WE']]) {
        const rule = buildRRule({ repeat, byDay, ...ending });
        assert.ok(rule !== null, `${repeat} produced no rule`);
        // Throws UnsupportedRRuleError if the builder emitted something the
        // engine cannot expand.
        const parsed = parseRRule(rule);
        assert.ok(parsed.freq.length > 0);
        checked += 1;
      }
    }
  }
  // Guards against the loop silently covering nothing.
  assert.equal(checked, repeats.length * endings.length * 2);
});

test('returns null for the non-recurring selections', () => {
  assert.equal(buildRRule({ repeat: 'none', endRepeat: 'never' }), null);
  // A variable-schedule master has no rule: its times are not yet known.
  assert.equal(buildRRule({ repeat: 'variable', endRepeat: 'never' }), null);
});

test('ignores an end selection whose value is missing', () => {
  // The form can be in 'ondate' with no date chosen yet. Emitting `UNTIL=`
  // would produce a rule the parser rejects.
  assert.equal(buildRRule({ repeat: 'daily', endRepeat: 'ondate' }), 'FREQ=DAILY');
  assert.equal(buildRRule({ repeat: 'daily', endRepeat: 'aftercount' }), 'FREQ=DAILY');
});

test('emits UNTIL and COUNT in the forms the parser accepts', () => {
  assert.equal(
    buildRRule({ repeat: 'daily', endRepeat: 'ondate', endDate: '2026-12-31' }),
    'FREQ=DAILY;UNTIL=20261231',
  );
  assert.equal(
    buildRRule({ repeat: 'daily', endRepeat: 'aftercount', count: 5 }),
    'FREQ=DAILY;COUNT=5',
  );
});

test('biweekly is a weekly rule with INTERVAL=2, and BYDAY still applies', () => {
  assert.equal(
    buildRRule({ repeat: 'biweekly', byDay: ['TU'], endRepeat: 'never' }),
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
  );
});
