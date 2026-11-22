import { fireEvent, render } from '@testing-library/react-native';
import { PrivacyDisclosure } from './PrivacyDisclosure';

describe('PrivacyDisclosure', () => {
  it('states what happens to a scanned screenshot', async () => {
    const { getByText } = await render(<PrivacyDisclosure mode="gate" onDismiss={jest.fn()} />);

    expect(getByText(/sent to Anthropic \(the Claude AI service\)/)).toBeTruthy();
    expect(
      getByText(/If Claude cannot read an image clearly, it is also sent to Amazon Textract/),
    ).toBeTruthy();
    expect(
      getByText(/The screenshot, the text read from it and the events found in it are stored\./),
    ).toBeTruthy();
  });

  it('says there is no in-app deletion yet', async () => {
    const { getByText } = await render(<PrivacyDisclosure mode="gate" onDismiss={jest.fn()} />);

    expect(getByText(/There is no way to delete them in the app yet\./)).toBeTruthy();
  });

  it('says account deletion removes the text and events but not the screenshot images', async () => {
    const { getByText } = await render(<PrivacyDisclosure mode="gate" onDismiss={jest.fn()} />);

    expect(
      getByText(
        /Deleting your account removes the text and events, but does not yet remove the screenshot images\./,
      ),
    ).toBeTruthy();
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
