import { eventColor, occurrenceWindow, shiftLocalDateTime } from './occurrenceWindow';

/** Minimal occurrence, so each test states only the field it is about. */
function occurrence(overrides: Partial<Parameters<typeof eventColor>[0]> = {}) {
  return {
    eventId: 'e1',
    occurrenceDate: '2026-09-07',
    title: 'Standup',
    localStart: '2026-09-07T09:00:00',
    localEnd: '2026-09-07T09:30:00',
    timezoneId: 'America/New_York',
    visibility: 'private',
    colorLabel: null as string | null,
    isException: false,
    isVariableSchedule: false,
    ...overrides,
  };
}

describe('occurrenceWindow', () => {
  it('asks the client for the whole visible month, not the visible days', () => {
    // The month grid is always 6x7, so September 2026 renders late August and
    // early October too. Fetching only 09-01..09-30 leaves those padding cells
    // permanently blank — the user swipes to a month and sees a partial week.
    const window = occurrenceWindow(2026, 9);

    expect(window.from < '2026-09-01').toBe(true);
    expect(window.to > '2026-09-30').toBe(true);

    const days =
      (Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / 86_400_000 +
      1;
    expect(days).toBe(42);
  });

  it('covers every cell the grid renders, for a month that starts on a Sunday', () => {
    // A month starting on the grid's first column is the case where a naive
    // "first of month" window looks correct and still drops the trailing weeks.
    const window = occurrenceWindow(2026, 2);
    expect(window.from).toBe('2026-02-01');
    expect(window.to).toBe('2026-03-14');
  });
});

describe('shiftLocalDateTime', () => {
  it('shifts the wall-clock time without touching the date when it does not roll over', () => {
    expect(shiftLocalDateTime('2026-09-07T09:00:00', 1)).toBe('2026-09-07T10:00:00');
  });

  it('rolls the date over at midnight', () => {
    expect(shiftLocalDateTime('2026-09-07T23:30:00', 1)).toBe('2026-09-08T00:30:00');
  });

  it('stays on local wall time across a DST boundary rather than shifting by a real hour', () => {
    // 2026-11-01 is the US DST fall-back. These are LOCAL times with a separate
    // `timezoneId`, and the server derives UTC (AD-4). Doing this arithmetic in
    // UTC would silently move the event by two hours on exactly two days a
    // year — the kind of bug that only ever reproduces in November.
    expect(shiftLocalDateTime('2026-11-01T01:00:00', 1)).toBe('2026-11-01T02:00:00');
  });

  it('rolls over a month end', () => {
    expect(shiftLocalDateTime('2026-09-30T23:00:00', 1)).toBe('2026-10-01T00:00:00');
  });
});

describe('eventColor', () => {
  it('never passes a sentinel colour string to a native colour prop', () => {
    // `colorLabel` is user-writable free text. React Native given a non-colour
    // renders transparent with a warning rather than throwing, so this is
    // invisible in testing and visible to the user as a missing event.
    const color = eventColor(occurrence({ colorLabel: '__birthday__' }), 0);

    expect(color).not.toBe('__birthday__');
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('rejects any colorLabel that is not a hex colour, not just the sentinel', () => {
    // Guarding the one known sentinel would leave every other bad value — and
    // the sentinel is only special because we happened to ship it.
    for (const bad of ['red', 'rgb(1,2,3)', '#fff', '', '  ', 'javascript:alert(1)']) {
      expect(eventColor(occurrence({ colorLabel: bad }), 0)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('honours a valid hex colorLabel', () => {
    expect(eventColor(occurrence({ colorLabel: '#30a46c' }), 0)).toBe('#30a46c');
  });

  it('shows sensitive-public occurrences as a busy block regardless of colour', () => {
    const color = eventColor(
      occurrence({ visibility: 'sensitive_public', colorLabel: '#30a46c' }),
      0,
    );
    expect(color).not.toBe('#30a46c');
  });
});
