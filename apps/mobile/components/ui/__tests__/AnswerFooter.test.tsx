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
});
