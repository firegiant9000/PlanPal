import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatLocal, localToUtc, parseLocal } from './timezone.js';

test('parseLocal accepts minute and second precision', () => {
  assert.deepEqual(parseLocal('2026-06-10T09:30'), {
    year: 2026,
    month: 6,
    day: 10,
    hour: 9,
    minute: 30,
    second: 0,
  });
  assert.equal(parseLocal('2026-06-10T09:30:45').second, 45);
});

test('parseLocal rejects malformed input', () => {
  assert.throws(() => parseLocal('2026-06-10 09:30'), RangeError);
  assert.throws(() => parseLocal('not-a-date'), RangeError);
});

test('formatLocal always renders seconds', () => {
  assert.equal(formatLocal(parseLocal('2026-06-10T09:30')), '2026-06-10T09:30:00');
});

test('localToUtc honors DST: summer NY is UTC-4', () => {
  // 2026-06-10 is during EDT (UTC-4): 09:00 local -> 13:00Z.
  assert.equal(localToUtc(parseLocal('2026-06-10T09:00'), 'America/New_York'), '2026-06-10T13:00:00Z');
});

test('localToUtc honors standard time: winter NY is UTC-5', () => {
  // 2026-01-10 is during EST (UTC-5): 09:00 local -> 14:00Z.
  assert.equal(localToUtc(parseLocal('2026-01-10T09:00'), 'America/New_York'), '2026-01-10T14:00:00Z');
});

test('localToUtc handles a non-US zone', () => {
  // Asia/Kolkata is UTC+5:30 year-round.
  assert.equal(localToUtc(parseLocal('2026-06-10T09:00'), 'Asia/Kolkata'), '2026-06-10T03:30:00Z');
});

test('localToUtc throws on an invalid zone', () => {
  assert.throws(() => localToUtc(parseLocal('2026-06-10T09:00'), 'Not/AZone'));
});

test('localToUtc resolves a spring-forward GAP by shifting forward', () => {
  // 2026-03-08 NY springs forward 02:00 EST -> 03:00 EDT; 02:30 does not exist.
  // "compatible" shifts it forward to 03:30 EDT (UTC-4) -> 07:30Z, NOT back to
  // 01:30 EST (06:30Z) as the old two-probe approach did.
  assert.equal(localToUtc(parseLocal('2026-03-08T02:30'), 'America/New_York'), '2026-03-08T07:30:00Z');
  // A time safely after the gap is unaffected (EDT, UTC-4).
  assert.equal(localToUtc(parseLocal('2026-03-08T09:30'), 'America/New_York'), '2026-03-08T13:30:00Z');
});

test('localToUtc resolves a fall-back AMBIGUOUS hour to the earlier instant', () => {
  // 2026-11-01 NY falls back 02:00 EDT -> 01:00 EST; 01:30 occurs twice.
  // "compatible" picks the FIRST (EDT, UTC-4): 01:30 -> 05:30Z, not 06:30Z (EST).
  assert.equal(localToUtc(parseLocal('2026-11-01T01:30'), 'America/New_York'), '2026-11-01T05:30:00Z');
});

test('localToUtc is correct on a leap day', () => {
  // 2028 is a leap year — 2028-02-29 is a real date (EST, UTC-5).
  assert.equal(localToUtc(parseLocal('2028-02-29T09:00'), 'America/New_York'), '2028-02-29T14:00:00Z');
});
