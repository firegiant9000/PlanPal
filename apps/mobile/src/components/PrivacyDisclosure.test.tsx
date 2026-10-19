import { fireEvent, render } from '@testing-library/react-native';
import { PrivacyDisclosure } from './PrivacyDisclosure';

describe('PrivacyDisclosure', () => {
  it('states what happens to a scanned screenshot', async () => {
    const { getByText } = await render(<PrivacyDisclosure mode="gate" onDismiss={jest.fn()} />);

    expect(getByText(/sent to Anthropic \(the Claude AI service\)/)).toBeTruthy();
    expect(getByText(/Amazon Textract/)).toBeTruthy();
    expect(getByText(/stored with your account/)).toBeTruthy();
    expect(getByText(/does not delete them automatically yet/)).toBeTruthy();
  });

  it('does not claim screenshots are discarded after the scan', async () => {
    const { queryByText } = await render(<PrivacyDisclosure mode="gate" onDismiss={jest.fn()} />);

    expect(queryByText(/not retained/)).toBeNull();
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
