import { render, screen, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('renders its label and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<Button label="I'm in" onPress={onPress} />);

    await fireEvent.press(screen.getByText("I'm in"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="I'm in" onPress={onPress} disabled />);

    await fireEvent.press(screen.getByText("I'm in"));

    expect(onPress).not.toHaveBeenCalled();
  });

  it('exposes the disabled state to accessibility', async () => {
    await render(<Button label="Locked" disabled />);

    expect(screen.getByRole('button', { disabled: true })).toBeTruthy();
  });
});
