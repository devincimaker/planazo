import { render, screen, fireEvent } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';
import { AnswerFooter } from '../AnswerFooter';

describe('AnswerFooter', () => {
  it('offers both answers when unanswered', async () => {
    const onYes = jest.fn();
    const onNo = jest.fn();
    await render(<AnswerFooter onYes={onYes} onNo={onNo} />);

    await fireEvent.press(screen.getByText("I'm in"));
    expect(onYes).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByText("Can't make it"));
    expect(onNo).toHaveBeenCalledTimes(1);
  });

  it('collapses to a changeable row once answered yes', async () => {
    const onChange = jest.fn();
    await render(<AnswerFooter answered="yes" onChange={onChange} />);

    expect(screen.queryByText("Can't make it")).toBeNull();
    expect(screen.getByText("You're in")).toBeTruthy();

    await fireEvent.press(screen.getByText('Change'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows the custom answer label (flexible plans: "Sent 2 dates")', async () => {
    await render(<AnswerFooter answered="yes" answerLabel="You sent 2 dates" />);

    expect(screen.getByText('You sent 2 dates')).toBeTruthy();
  });

  // PLA-22: both sizes used to pin "Can't make it" to a hand-measured width
  // (150 / 118), which is a guess about how wide the label renders — wrong for
  // a longer label, and wrong for every label at accessibility text sizes.
  it.each(['md', 'lg'] as const)('gives the %s decline button no fixed width', async (size) => {
    await render(<AnswerFooter size={size} />);

    const style = StyleSheet.flatten(
      screen.getByTestId('answer-no').props.style
    ) as ViewStyle;
    expect(style.width).toBeUndefined();
    expect(style.flexBasis).toBeUndefined();
    expect(style.flexShrink).toBe(1);
  });

  it('renders the declined state', async () => {
    await render(<AnswerFooter answered="no" />);

    expect(screen.getByText("You can't make it")).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
  });

  // PLA-20 put a dead "Full" button here, which said the truth and offered
  // nothing. PLA-37 gives it somewhere to go.
  describe('full', () => {
    it('offers the queue instead of "I\'m in"', async () => {
      const onWait = jest.fn();
      const onYes = jest.fn();
      await render(<AnswerFooter full onYes={onYes} onWait={onWait} />);

      expect(screen.queryByText("I'm in")).toBeNull();
      expect(screen.queryByText('Full')).toBeNull();

      await fireEvent.press(screen.getByText('Take the next spot'));
      expect(onWait).toHaveBeenCalledTimes(1);
      // Joining a queue is not saying you'll be there.
      expect(onYes).not.toHaveBeenCalled();
    });

    it('falls back to the dead button when the caller offers no queue', async () => {
      // A caller that has not been taught about queueing must not appear to
      // promise one.
      await render(<AnswerFooter full />);

      expect(screen.getByText('Full')).toBeTruthy();
      expect(screen.queryByText('Take the next spot')).toBeNull();
    });

    it('keeps "Can\'t make it" live — declining still takes you off the list', async () => {
      const onNo = jest.fn();
      await render(<AnswerFooter full onNo={onNo} onWait={jest.fn()} />);

      await fireEvent.press(screen.getByText("Can't make it"));
      expect(onNo).toHaveBeenCalledTimes(1);
    });

    it('does not touch the answered state — being in outlasts the plan filling up', async () => {
      const onChange = jest.fn();
      await render(<AnswerFooter full answered="yes" onChange={onChange} />);

      expect(screen.queryByText('Full')).toBeNull();
      expect(screen.queryByText('Take the next spot')).toBeNull();
      expect(screen.getByText("You're in")).toBeTruthy();

      await fireEvent.press(screen.getByText('Change'));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });

  // PLA-37: the third answer. Not in, not out, waiting.
  describe('waiting', () => {
    it('collapses to a changeable row showing where you stand', async () => {
      const onChange = jest.fn();
      await render(
        <AnswerFooter answered="pending" answerLabel="You're 3rd in line" onChange={onChange} />
      );

      expect(screen.queryByText("Can't make it")).toBeNull();
      expect(screen.getByText("You're 3rd in line")).toBeTruthy();

      // Leaving the queue has to stay one tap away, same as leaving a plan.
      await fireEvent.press(screen.getByText('Change'));
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('reads neither as in nor as out', async () => {
      await render(<AnswerFooter answered="pending" />);

      expect(screen.getByText("You're on the waiting list")).toBeTruthy();
      expect(screen.queryByText("You're in")).toBeNull();
      expect(screen.queryByText("You can't make it")).toBeNull();
    });

    it('is tinted apart from both settled answers', async () => {
      await render(
        <>
          <AnswerFooter answered="yes" testID="tone-yes" />
          <AnswerFooter answered="no" testID="tone-no" />
          <AnswerFooter answered="pending" testID="tone-pending" />
        </>
      );

      const bg = (id: string) =>
        (StyleSheet.flatten(screen.getByTestId(id).props.style) as ViewStyle).backgroundColor;

      expect(bg('tone-pending')).not.toBe(bg('tone-yes'));
      expect(bg('tone-pending')).not.toBe(bg('tone-no'));
    });
  });
});
