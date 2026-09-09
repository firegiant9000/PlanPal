import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MonthGrid } from './MonthGrid';
import type { WebOccurrence } from './types';

afterEach(cleanup);

function occurrence(overrides: Partial<WebOccurrence> = {}): WebOccurrence {
  return {
    eventId: 'e1',
    occurrenceDate: '2026-09-07',
    title: 'Weekly standup',
    localStart: '2026-09-07T09:00:00',
    localEnd: '2026-09-07T09:30:00',
    timezoneId: 'America/New_York',
    visibility: 'private',
    colorLabel: null,
    isException: false,
    isVariableSchedule: false,
    ...overrides,
  };
}

function byDate(items: WebOccurrence[]): Record<string, WebOccurrence[]> {
  const map: Record<string, WebOccurrence[]> = {};
  for (const o of items) (map[o.occurrenceDate] ??= []).push(o);
  return map;
}

describe('MonthGrid', () => {
  it('renders 42 cells for any month', () => {
    // Six weeks by seven days, always — `calendar-core` guarantees the shape.
    // A grid that sometimes renders 35 makes the last week of some months
    // unreachable, and it only reproduces in the months where it happens.
    for (const [year, month] of [
      [2026, 2],
      [2026, 9],
      [2027, 1],
    ] as const) {
      const { unmount } = render(
        <MonthGrid year={year} month={month} occurrencesByDate={{}} onSelectDate={() => {}} />,
      );
      expect(screen.getAllByRole('gridcell')).toHaveLength(42);
      unmount();
    }
  });

  it('places an occurrence on its own date and nowhere else', () => {
    render(
      <MonthGrid
        year={2026}
        month={9}
        occurrencesByDate={byDate([occurrence()])}
        onSelectDate={() => {}}
      />,
    );

    const cell = screen.getByTestId('day-2026-09-07');
    expect(within(cell).getByText('Weekly standup')).toBeInTheDocument();

    // Exactly one cell in the whole grid mentions it.
    expect(screen.getAllByText('Weekly standup')).toHaveLength(1);
  });

  it('renders a moved override at its overridden time, not the master time', () => {
    // PR #3's defects were all in this area. The server expands the override,
    // so the occurrence already carries 11:00 — the failure mode is a view that
    // recomputes the time from the series instead of reading the occurrence.
    render(
      <MonthGrid
        year={2026}
        month={9}
        occurrencesByDate={byDate([
          occurrence({
            occurrenceDate: '2026-09-14',
            localStart: '2026-09-14T11:00:00',
            localEnd: '2026-09-14T11:30:00',
            title: 'Standup (moved)',
            isException: true,
          }),
        ])}
        onSelectDate={() => {}}
      />,
    );

    const cell = screen.getByTestId('day-2026-09-14');
    expect(within(cell).getByText(/11:00/)).toBeInTheDocument();
    expect(within(cell).queryByText(/9:00/)).not.toBeInTheDocument();
  });
});
