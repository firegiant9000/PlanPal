import { fireEvent, render } from '@testing-library/react-native';
import { Button } from './Button';

/**
 * The reason `jest-expo` exists in this repo (D-H): this file renders a real
 * React Native tree. Vitest cannot transform React Native's untranspiled Flow
 * sources, so none of it is reachable from the Vitest suites.
 *
 * Two version-specific details, both learned by watching them fail:
 *  - `render` is ASYNC in @testing-library/react-native 14 (React 19 concurrent
 *    rendering), so it must be awaited.
 *  - Queries come from its return value rather than the `screen` singleton.
 *    Under `node-linker=hoisted` the singleton resolved to a different module
 *    instance than `render` populated, and every `screen.*` call reported
 *    "`render` function has not been called".
 */
describe('Button', () => {
  it('renders its label and calls onPress when pressed', async () => {
    const onPress = jest.fn();
    const { getByText, getByRole } = await render(<Button label="Save event" onPress={onPress} />);

    expect(getByText('Save event')).toBeTruthy();

    fireEvent.press(getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('hides the label and refuses the press while loading', async () => {
    // Same guarantee the web Button carries. Asserting it on both platforms is
    // the point of the shared ButtonContract: a divergence here is a bug the
    // contract is supposed to make impossible.
    const onPress = jest.fn();
    const { queryByText, getByRole } = await render(
      <Button label="Save event" loading onPress={onPress} />,
    );

    expect(queryByText('Save event')).toBeNull();

    fireEvent.press(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
