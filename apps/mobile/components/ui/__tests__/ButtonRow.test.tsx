import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { ButtonRow } from '../ButtonRow';

const flat = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style) as ViewStyle;

describe('ButtonRow', () => {
  it('renders both actions and fires the right one', async () => {
    const onNo = jest.fn();
    const onYes = jest.fn();
    await render(
      <ButtonRow
        secondary={{ label: 'None of them', variant: 'secondary', onPress: onNo, testID: 'no' }}
        primary={{ label: 'Send 2 dates', onPress: onYes, testID: 'yes' }}
      />
    );

    await fireEvent.press(screen.getByText('None of them'));
    expect(onNo).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByText('Send 2 dates'));
    expect(onYes).toHaveBeenCalledTimes(1);
  });

  it('passes disabled through to either side', async () => {
    const onYes = jest.fn();
    await render(
      <ButtonRow
        secondary={{ label: 'None of them', variant: 'secondary', testID: 'no' }}
        primary={{ label: 'Tap the dates you can do', disabled: true, onPress: onYes, testID: 'yes' }}
      />
    );

    await fireEvent.press(screen.getByTestId('yes'));
    expect(onYes).not.toHaveBeenCalled();
  });

  // PLA-22: the secondary was pinned to a hand-measured flexBasis, so a label
  // wider than the guess ("None of them") lost its end to an ellipsis. No pixel
  // width may come back — the way out sizes to its own measured label, at any
  // text size, and the primary asks for a share of the row rather than a width.
  it('gives neither button a fixed width', async () => {
    await render(
      <ButtonRow
        secondary={{ label: 'None of them', variant: 'secondary', testID: 'no' }}
        primary={{ label: 'Send 2 dates', testID: 'yes' }}
      />
    );

    for (const id of ['no', 'yes']) {
      const style = flat(id);
      expect(style.width).toBeUndefined();
      expect(style.flex).toBeUndefined();
      expect(typeof style.flexBasis).not.toBe('number');
      expect(style.flexGrow).toBeGreaterThan(0);
      expect(style.flexShrink).toBe(1);
    }

    // The way out is measured, never declared...
    expect(flat('no').flexBasis).toBeUndefined();
    // ...while the primary claims half the row, so a long primary label wraps
    // inside its own half instead of pushing the pair onto separate lines.
    expect(flat('yes').flexBasis).toBe('50%');
    // ...and it still takes the slack, leaving the secondary hugging its label
    expect(flat('yes').flexGrow!).toBeGreaterThan(flat('no').flexGrow!);
  });

  // When the two no longer fit side by side, the primary drops to its own line
  // and both go full width — that is what lets the words wrap instead of being
  // cut at accessibility text sizes.
  //
  // The line count is uncapped (RN's `0`) rather than a small number: a cap is
  // a guess at how many lines a label needs, and it was wrong at the largest
  // accessibility size, where "Tap the dates you can do" wants three and a cap
  // of two ellipsised it (PLA-22 review).
  it('wraps rather than squeezing, over as many lines as the label needs', async () => {
    await render(
      <ButtonRow
        testID="row"
        secondary={{ label: 'None of them', variant: 'secondary', testID: 'no' }}
        primary={{ label: 'Tap the dates you can do', testID: 'yes' }}
      />
    );

    expect(flat('row').flexWrap).toBe('wrap');
    expect(screen.getByText('None of them').props.numberOfLines).toBe(0);
    expect(screen.getByText('Tap the dates you can do').props.numberOfLines).toBe(0);
  });
});
