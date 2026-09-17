import { fireEvent, render } from '@testing-library/react-native';
import { FeedbackForm } from './FeedbackForm';

const PLACEHOLDER = "What's on your mind?";

/**
 * `fireEvent.changeText` returns a promise in this RNTL version (React 19
 * concurrent rendering) — awaiting it is what makes the update visible to a
 * query made right after, the same reason `render` itself must be awaited
 * (see `Button.test.tsx`'s doc comment). Skipping the `await` leaves every
 * subsequent query reading the pre-change tree, silently.
 */
async function typeMessage(getByPlaceholderText: (text: string) => unknown, text: string) {
  await fireEvent.changeText(getByPlaceholderText(PLACEHOLDER) as Parameters<typeof fireEvent.changeText>[0], text);
}

/** Rendered in this order: Send, then Cancel. */
function buttons(getAllByRole: (role: string) => unknown[]) {
  const all = getAllByRole('button') as Parameters<typeof fireEvent.press>[0][];
  return { send: all[0]!, cancel: all[1]! };
}

describe('FeedbackForm', () => {
  it('disables Send until a message is entered, then submits the trimmed text', async () => {
    const onSubmit = jest.fn();
    const { getByPlaceholderText, getAllByRole } = await render(
      <FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    fireEvent.press(buttons(getAllByRole).send);
    expect(onSubmit).not.toHaveBeenCalled();

    await typeMessage(getByPlaceholderText, '  The calendar is great  ');
    fireEvent.press(buttons(getAllByRole).send);

    expect(onSubmit).toHaveBeenCalledWith({ message: 'The calendar is great' });
  });

  it('does not submit a message that is only whitespace', async () => {
    const onSubmit = jest.fn();
    const { getByPlaceholderText, getAllByRole } = await render(
      <FeedbackForm onSubmit={onSubmit} onCancel={jest.fn()} />,
    );

    await typeMessage(getByPlaceholderText, '   ');
    fireEvent.press(buttons(getAllByRole).send);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when Cancel is pressed', async () => {
    const onCancel = jest.fn();
    const { getAllByRole } = await render(<FeedbackForm onSubmit={jest.fn()} onCancel={onCancel} />);

    fireEvent.press(buttons(getAllByRole).cancel);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while submitting', async () => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    const { getByPlaceholderText, getAllByRole } = await render(
      <FeedbackForm onSubmit={onSubmit} onCancel={onCancel} submitting />,
    );

    await typeMessage(getByPlaceholderText, 'Still typing');
    const { send, cancel } = buttons(getAllByRole);
    // Both buttons render disabled (Send via `loading`, Cancel via
    // `disabled`) while submitting — a press on either must not fire, or a
    // slow network reply could double-submit.
    fireEvent.press(send);
    fireEvent.press(cancel);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
