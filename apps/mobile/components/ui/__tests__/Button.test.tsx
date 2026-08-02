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

  // A button is a target, not a paragraph — but a layout that can give the
  // label the whole width may say so, and then it wraps instead of truncating.
  it('keeps its label on one line unless the caller allows more', async () => {
    const { rerender } = await render(<Button label="None of them" />);
    expect(screen.getByText('None of them').props.numberOfLines).toBe(1);

    // 0 is RN's "as many as it takes" — what ButtonRow passes
    await rerender(<Button label="None of them" numberOfLines={0} />);
    expect(screen.getByText('None of them').props.numberOfLines).toBe(0);
  });
});
