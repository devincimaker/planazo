import { render, screen, fireEvent } from '@testing-library/react-native';
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

  it('renders the declined state', async () => {
    await render(<AnswerFooter answered="no" />);

    expect(screen.getByText("You can't make it")).toBeTruthy();
    expect(screen.getByText('Change')).toBeTruthy();
  });

  // PLA-20: the cap is enforced in the database, so the point of this state is
  // to say so before the tap rather than after a round-trip that fails.
  describe('full', () => {
    it('replaces "I\'m in" with a dead "Full" button', async () => {
      const onYes = jest.fn();
      await render(<AnswerFooter full onYes={onYes} />);

      expect(screen.queryByText("I'm in")).toBeNull();
      expect(screen.getByText('Full')).toBeTruthy();

      await fireEvent.press(screen.getByTestId('answer-yes'));
      expect(onYes).not.toHaveBeenCalled();
    });

    it('keeps "Can\'t make it" live — declining still takes you off the list', async () => {
      const onNo = jest.fn();
      await render(<AnswerFooter full onNo={onNo} />);

      await fireEvent.press(screen.getByText("Can't make it"));
      expect(onNo).toHaveBeenCalledTimes(1);
    });

    it('does not touch the answered state — being in outlasts the plan filling up', async () => {
      const onChange = jest.fn();
      await render(<AnswerFooter full answered="yes" onChange={onChange} />);

      expect(screen.queryByText('Full')).toBeNull();
      expect(screen.getByText("You're in")).toBeTruthy();

      await fireEvent.press(screen.getByText('Change'));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
