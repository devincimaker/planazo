import { StyleSheet, type ViewStyle } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { AnswerFooter } from '../AnswerFooter';
import { Button } from '../Button';
import { Chip } from '../Chip';
import { DateOptionRow } from '../DateOptionRow';
import { ListRow } from '../ListRow';
import { MonthCalendar } from '../MonthCalendar';

/**
 * PLA-40. Every one of these controls was sized by how it looked — padding
 * plus a line height — and a good number came out under Apple's 44pt: Button
 * `md` at 42, Chip at 37, the month arrows at 28×24.
 *
 * The fix was structural rather than a layer of hitSlop, so the assertion can
 * be structural too: read the floor off the style the component actually
 * renders. A control whose padding alone clears 44 still declares the floor,
 * because padding is a function of the font and the font is a function of the
 * user's text-size setting.
 */
function floorOf(style: unknown) {
  const flat = (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
  return {
    height: (flat.minHeight ?? flat.height) as number | undefined,
    width: (flat.minWidth ?? flat.width) as number | undefined,
  };
}

function expectMeetsMinimum(testID: string, axis: 'height' | 'both' = 'height') {
  const { height, width } = floorOf(screen.getByTestId(testID).props.style);

  expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  if (axis === 'both') {
    expect(width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  }
}

describe('touch targets meet 44pt', () => {
  it('Button, at both sizes', async () => {
    const { rerender } = await render(<Button label="I'm in" size="lg" testID="btn" />);
    expectMeetsMinimum('btn');

    // The one that was actually short: 12 + 18 + 12 = 42.
    await rerender(<Button label="I'm in" size="md" testID="btn" />);
    expectMeetsMinimum('btn');
  });

  it('Button, even when a caller passes its own style', async () => {
    // ButtonRow hands every button a flex style; the floor has to survive it.
    await render(
      <Button label="Send 3 dates" size="md" style={{ flexGrow: 1 }} testID="btn" />,
    );
    expectMeetsMinimum('btn');
  });

  it('Chip', async () => {
    // Was 37: 8 + 18 + 8 + 1.5 border a side.
    await render(<Chip label="All" testID="chip" />);
    expectMeetsMinimum('chip');
  });

  it('AnswerFooter, at both sizes, once answered', async () => {
    // Unanswered it renders a ButtonRow, which Button already covers. Answered
    // it is a single row and the only way back out of an RSVP.
    const { rerender } = await render(
      <AnswerFooter answered="yes" size="lg" testID="answer" />,
    );
    expectMeetsMinimum('answer');

    await rerender(<AnswerFooter answered="yes" size="md" testID="answer" />);
    expectMeetsMinimum('answer');
  });

  it('DateOptionRow', async () => {
    await render(<DateOptionRow label="Fri 12 Sep" meta="4 in" testID="date-option" />);
    expectMeetsMinimum('date-option');
  });

  it('ListRow, when it is tappable', async () => {
    await render(<ListRow title="Notifications" value="On" onPress={() => {}} testID="row" />);
    expectMeetsMinimum('row');
  });

  it('MonthCalendar day cells', async () => {
    await render(<MonthCalendar selected={[]} onToggleDay={() => {}} />);

    // Whichever day the month happens to start on, every cell is one style.
    const days = screen.getAllByTestId(/^cal-day-/);
    expect(days.length).toBeGreaterThan(0);

    for (const day of days) {
      const { height } = floorOf(day.props.style);
      expect(height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('MonthCalendar month arrows, on both axes', async () => {
    // The smallest target in the app before this: a ~12pt chevron in a 28×24
    // box, and the only way to reach any month but this one.
    await render(<MonthCalendar selected={[]} onToggleDay={() => {}} />);

    expectMeetsMinimum('cal-prev', 'both');
    expectMeetsMinimum('cal-next', 'both');
  });
});
