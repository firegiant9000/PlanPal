import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrivacyDisclosure } from './PrivacyDisclosure';

afterEach(cleanup);

describe('PrivacyDisclosure', () => {
  it('states what happens to a scanned screenshot', () => {
    render(<PrivacyDisclosure mode="gate" onDismiss={vi.fn()} />);

    expect(screen.getByText(/sent to Anthropic \(the Claude AI service\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/If Claude cannot read an image clearly, it is also sent to Amazon Textract/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The screenshot, the text read from it and the events found in it are stored\./),
    ).toBeInTheDocument();
  });

  it('says there is no in-app deletion yet', () => {
    render(<PrivacyDisclosure mode="gate" onDismiss={vi.fn()} />);

    expect(
      screen.getByText(/There is no way to delete them in the app yet\./),
    ).toBeInTheDocument();
  });

  it('says account deletion removes the text and events but not the screenshot images', () => {
    render(<PrivacyDisclosure mode="gate" onDismiss={vi.fn()} />);

    expect(
      screen.getByText(
        /Deleting your account removes the text and events, but does not yet remove the screenshot images\./,
      ),
    ).toBeInTheDocument();
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
