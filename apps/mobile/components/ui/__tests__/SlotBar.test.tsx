import { render, screen } from '@testing-library/react-native';
import { SlotBar } from '../SlotBar';

describe('SlotBar', () => {
  it('renders one slot per place up to the cap', async () => {
    await render(<SlotBar going={2} min={3} cap={6} />);

    expect(screen.getAllByTestId('slot-filled')).toHaveLength(2);
    expect(screen.getAllByTestId('slot-required')).toHaveLength(1);
    expect(screen.getAllByTestId('slot-optional')).toHaveLength(3);
  });

  it('falls back to the floor when there is no cap', async () => {
    await render(<SlotBar going={1} min={4} />);

    expect(screen.getAllByTestId('slot-filled')).toHaveLength(1);
    expect(screen.getAllByTestId('slot-required')).toHaveLength(3);
    expect(screen.queryAllByTestId('slot-optional')).toHaveLength(0);
  });

  it('never renders fewer slots than people already in (overfull edge)', async () => {
    await render(<SlotBar going={5} min={2} cap={4} />);

    expect(screen.getAllByTestId('slot-filled')).toHaveLength(5);
  });

  it('describes itself for screen readers', async () => {
    await render(<SlotBar going={2} min={3} cap={6} testID="slots" />);

    expect(screen.getByLabelText('2 in, minimum 3, room for 6')).toBeTruthy();
  });
});
