import { fireEvent, render } from '@testing-library/react-native';
import { PrivacyDisclosure } from './PrivacyDisclosure';

describe('PrivacyDisclosure', () => {
  it('states what happens to a scanned screenshot', async () => {
    const { getByText } = await render(<PrivacyDisclosure mode="gate" onDismiss={jest.fn()} />);

    expect(getByText(/third-party AI service/)).toBeTruthy();
    expect(getByText(/not retained/)).toBeTruthy();
  });

  it('labels the action "continue" in gate mode and calls onDismiss when pressed', async () => {
    const onDismiss = jest.fn();
    const { getByText, getByRole } = await render(
      <PrivacyDisclosure mode="gate" onDismiss={onDismiss} />,
    );

    expect(getByText('I understand, continue')).toBeTruthy();
    fireEvent.press(getByRole('button'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('labels the action "Close" in review mode', async () => {
    const { getByText } = await render(<PrivacyDisclosure mode="review" onDismiss={jest.fn()} />);

    expect(getByText('Close')).toBeTruthy();
  });
});
