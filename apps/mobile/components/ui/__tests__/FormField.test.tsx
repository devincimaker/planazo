import { StyleSheet } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { FormField } from '../FormField';

async function renderField(props: Partial<React.ComponentProps<typeof FormField>> = {}) {
  return render(<FormField label="Email" testID="field" {...props} />);
}

describe('FormField', () => {
  // React Native has no htmlFor, so naming the input *is* the association.
  it('names the input with the visible label and hides the label from VoiceOver', async () => {
    const view = await renderField({ hint: 'We never share it' });

    const input = view.getByTestId('field');
    expect(input.props.accessibilityLabel).toBe('Email');
    expect(input.props.accessibilityHint).toBe('We never share it');

    // The label is on screen...
    expect(view.getByText('Email', { includeHiddenElements: true })).toBeTruthy();
    // ...but it is not a second thing for a screen reader to announce. Default
    // queries skip accessibility-hidden nodes, so finding nothing here is the
    // assertion: the words reach VoiceOver once, as the input's own name.
    expect(view.queryByText('Email')).toBeNull();
  });

  it('lets an explicit accessibilityLabel win over the visible label', async () => {
    const view = await renderField({ accessibilityLabel: 'Work email' });

    expect(view.getByTestId('field').props.accessibilityLabel).toBe('Work email');
  });

  /**
   * The regression this guards: the padding used to sit on the wrapper View,
   * which drew a 51pt-tall box around a ~21pt-tall input. Tapping the top or
   * bottom third of a field that plainly looks tappable did nothing at all.
   */
  it('puts the tap target on the input rather than the wrapper', async () => {
    const view = await renderField();
    const style = StyleSheet.flatten(view.getByTestId('field').props.style);

    expect(style.paddingVertical).toBeGreaterThanOrEqual(12);
    expect(style.paddingHorizontal).toBeGreaterThanOrEqual(12);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it('keeps the tap target when a reveal toggle shares the row', async () => {
    const view = await renderField({ secure: true });
    const style = StyleSheet.flatten(view.getByTestId('field').props.style);

    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.paddingVertical).toBeGreaterThanOrEqual(12);
  });

  it('starts masked and unmasks from the reveal toggle', async () => {
    const view = await renderField({ secure: true });

    expect(view.getByTestId('field').props.secureTextEntry).toBe(true);

    const toggle = view.getByTestId('field-reveal');
    expect(toggle.props.accessibilityLabel).toBe('Show password');

    await fireEvent.press(toggle);

    expect(view.getByTestId('field').props.secureTextEntry).toBe(false);
    expect(view.getByTestId('field-reveal').props.accessibilityLabel).toBe('Hide password');
  });

  it('has no reveal toggle on an ordinary field', async () => {
    const view = await renderField();

    expect(view.queryByTestId('field-reveal')).toBeNull();
  });
});
