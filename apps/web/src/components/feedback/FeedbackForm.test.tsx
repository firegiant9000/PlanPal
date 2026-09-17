import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackForm } from './FeedbackForm';

afterEach(cleanup);

describe('FeedbackForm', () => {
  it('disables Send until a message is entered, then submits the trimmed text', () => {
    const onSubmit = vi.fn();
    render(<FeedbackForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Feedback message'), {
      target: { value: '  The calendar is great  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).toHaveBeenCalledWith({ message: 'The calendar is great' });
  });

  it('does not submit a message that is only whitespace', () => {
    const onSubmit = vi.fn();
    render(<FeedbackForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Feedback message'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(<FeedbackForm onSubmit={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while submitting', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<FeedbackForm onSubmit={onSubmit} onCancel={onCancel} submitting />);

    // Send is `loading` while submitting, which swaps its label to '…' (same
    // Button contract mobile uses) — queried by position, not name, for that
    // reason; Cancel keeps its label and is disabled via `disabled` directly.
    const [send, cancel] = screen.getAllByRole('button');
    expect(send).toBeDisabled();
    expect(cancel).toBeDisabled();
    expect(screen.getByLabelText('Feedback message')).toBeDisabled();
  });
});
