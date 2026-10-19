import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyDisclosure } from './PrivacyDisclosure';

afterEach(cleanup);

describe('PrivacyDisclosure', () => {
  it('states what happens to a scanned screenshot', () => {
    render(<PrivacyDisclosure mode="gate" onDismiss={vi.fn()} />);

    expect(screen.getByText(/sent to Anthropic \(the Claude AI service\)/)).toBeInTheDocument();
    expect(screen.getByText(/Amazon Textract/)).toBeInTheDocument();
    expect(screen.getByText(/stored with your account/)).toBeInTheDocument();
    expect(screen.getByText(/does not delete them automatically yet/)).toBeInTheDocument();
  });

  it('does not claim screenshots are discarded after the scan', () => {
    render(<PrivacyDisclosure mode="gate" onDismiss={vi.fn()} />);

    expect(screen.queryByText(/not retained/)).not.toBeInTheDocument();
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
