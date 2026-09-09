import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OccurrenceSheet } from './OccurrenceSheet';
import type { WebOccurrence } from '../calendar/types';

afterEach(cleanup);

const occurrence: WebOccurrence = {
  eventId: 'evt-1',
  occurrenceDate: '2026-09-14',
  title: 'Weekly standup',
  localStart: '2026-09-14T09:00:00',
  localEnd: '2026-09-14T09:30:00',
  timezoneId: 'America/New_York',
  visibility: 'private',
  colorLabel: null,
  isException: false,
  isVariableSchedule: false,
};

function actions() {
  return {
    overrideOccurrence: vi.fn().mockResolvedValue(undefined),
    cancelOccurrence: vi.fn().mockResolvedValue(undefined),
    updateMaster: vi.fn().mockResolvedValue(undefined),
  };
}

describe('OccurrenceSheet', () => {
  it('sends a PATCH override for one date, not an update to the master', async () => {
    // PR #3's defect 1 got this distinction wrong in the other direction: a
    // change meant for one occurrence must not rewrite the series. Asserting
    // only that the override fired would still pass if the master were ALSO
    // updated, so the master call is asserted absent.
    const a = actions();
    render(<OccurrenceSheet occurrence={occurrence} {...a} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '11:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '11:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save this occurrence' }));

    expect(a.overrideOccurrence).toHaveBeenCalledWith('evt-1', '2026-09-14', {
      localStart: '2026-09-14T11:00:00',
      localEnd: '2026-09-14T11:30:00',
    });
    expect(a.updateMaster).not.toHaveBeenCalled();
    expect(a.cancelOccurrence).not.toHaveBeenCalled();
  });

  it('cancels exactly one date, and does not delete the series', async () => {
    const a = actions();
    render(<OccurrenceSheet occurrence={occurrence} {...a} onClose={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel this occurrence' }));

    expect(a.cancelOccurrence).toHaveBeenCalledWith('evt-1', '2026-09-14');
    expect(a.updateMaster).not.toHaveBeenCalled();
    expect(a.overrideOccurrence).not.toHaveBeenCalled();
  });
});
