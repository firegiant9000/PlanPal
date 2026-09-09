import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

// Next's App Router does not unmount between test files for us.
afterEach(cleanup);

describe('Button', () => {
  it('renders its label and calls onPress when clicked', () => {
    const onPress = vi.fn();
    render(<Button label="Save event" onPress={onPress} />);

    expect(screen.getByRole('button', { name: 'Save event' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides the label and refuses the click while loading', () => {
    // `loading` swaps the label for an ellipsis and disables the button. A
    // loading button that still fires onPress double-submits the form it is in,
    // which is exactly the bug this asserts against.
    const onPress = vi.fn();
    render(<Button label="Save event" loading onPress={onPress} />);

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    expect(screen.queryByText('Save event')).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
