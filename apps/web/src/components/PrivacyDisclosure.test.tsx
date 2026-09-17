import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyDisclosure } from './PrivacyDisclosure';

afterEach(cleanup);

describe('PrivacyDisclosure', () => {
  it('states what happens to a scanned screenshot', () => {
    render(<PrivacyDisclosure mode="gate" onDismiss={vi.fn()} />);

    expect(screen.getByText(/third-party AI service/)).toBeInTheDocument();
    expect(screen.getByText(/not retained/)).toBeInTheDocument();
  });

  it('labels the action "continue" in gate mode and calls onDismiss when clicked', () => {
    const onDismiss = vi.fn();
    render(<PrivacyDisclosure mode="gate" onDismiss={onDismiss} />);

    const button = screen.getByRole('button', { name: 'I understand, continue' });
    fireEvent.click(button);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('labels the action "Close" in review mode', () => {
    render(<PrivacyDisclosure mode="review" onDismiss={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
