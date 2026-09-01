import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapEventRow, type EventRow } from './row.js';

/**
 * `mapEventRow` is the boundary between PostgREST's snake_case rows and the
 * engine's camelCase records. It had no tests despite being on the hot path of
 * both `GET /occurrences` and the notification scheduler — and because Node's
 * coverage reporter omits files no test ever loads, its absence silently
 * inflated the package's reported coverage.
 */

const masterRow: EventRow = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'Standup',
  description: 'Daily sync',
  location: 'Zoom',
  local_start: '2026-06-01T09:30:00',
  local_end: '2026-06-01T09:45:00',
  timezone_id: 'America/New_York',
  is_master: true,
  master_event_id: null,
  recurrence_exception_date: null,
  recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  is_cancelled: false,
  is_variable_schedule: false,
  visibility: 'shared_all',
  color_label: '#30a46c',
};

test('mapEventRow maps every master column to its camelCase counterpart', () => {
  assert.deepEqual(mapEventRow(masterRow), {
    id: masterRow.id,
    ownerId: masterRow.owner_id,
    title: 'Standup',
    description: 'Daily sync',
    location: 'Zoom',
    localStart: '2026-06-01T09:30:00',
    localEnd: '2026-06-01T09:45:00',
    timezoneId: 'America/New_York',
    isMaster: true,
    masterEventId: null,
    recurrenceExceptionDate: null,
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    isCancelled: false,
    isVariableSchedule: false,
    visibility: 'shared_all',
    colorLabel: '#30a46c',
  });
});

test('mapEventRow preserves nulls on a sparse exception row (null = inherit)', () => {
  const exceptionRow: EventRow = {
    ...masterRow,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: null,
    description: null,
    location: null,
    local_start: null,
    local_end: null,
    timezone_id: null,
    is_master: false,
    master_event_id: masterRow.id,
    recurrence_exception_date: '2026-06-08',
    recurrence_rule: null,
    visibility: null,
    color_label: null,
  };

  const mapped = mapEventRow(exceptionRow);

  // Nulls must survive as nulls — the engine reads them as "inherit from the
  // master". Coercing them to undefined or '' would break inheritance.
  assert.equal(mapped.title, null);
  assert.equal(mapped.localStart, null);
  assert.equal(mapped.timezoneId, null);
  assert.equal(mapped.visibility, null);
  assert.equal(mapped.isMaster, false);
  assert.equal(mapped.masterEventId, masterRow.id);
  assert.equal(mapped.recurrenceExceptionDate, '2026-06-08');
});

test('mapEventRow carries the cancelled and variable-schedule flags through', () => {
  const cancelled = mapEventRow({ ...masterRow, is_master: false, is_cancelled: true });
  assert.equal(cancelled.isCancelled, true);

  const variable = mapEventRow({ ...masterRow, is_variable_schedule: true });
  assert.equal(variable.isVariableSchedule, true);
});
