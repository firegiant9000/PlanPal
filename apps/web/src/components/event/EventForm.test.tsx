import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventForm } from './EventForm';

afterEach(cleanup);

describe('EventForm', () => {
  it('submits a recurring master with the rule the selection implies', async () => {
    // The rule string is built by `@planpal/recurrence.buildRRule`, which is
    // round-trip tested against the parser. What this asserts is that the form
    // feeds it the selection the user actually made.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm timezoneId="America/New_York" onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Weekly standup' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-07' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '09:30' } });
    fireEvent.change(screen.getByLabelText('Repeats'), { target: { value: 'weekly' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      title: 'Weekly standup',
      localStart: '2026-09-07T09:00:00',
      localEnd: '2026-09-07T09:30:00',
      timezoneId: 'America/New_York',
      recurrenceRule: 'FREQ=WEEKLY',
      isVariableSchedule: false,
    });
  });

  it('sends no recurrenceRule for a one-off', () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<EventForm timezoneId="America/New_York" onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Dentist' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-09-07' } });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '09:30' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));

    expect(onSubmit.mock.calls[0]![0]).toMatchObject({ recurrenceRule: null });
  });

  it('refuses to submit without a title', () => {
    const onSubmit = vi.fn();
    render(<EventForm timezoneId="America/New_York" onSubmit={onSubmit} onCancel={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save event' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
