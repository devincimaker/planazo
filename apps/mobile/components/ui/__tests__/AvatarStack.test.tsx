import { render, screen } from '@testing-library/react-native';
import { AvatarStack } from '../AvatarStack';
import { Avatar, colorForName } from '../Avatar';

describe('AvatarStack', () => {
  it('shows initials for up to max names', async () => {
    await render(<AvatarStack names={['Marta', 'Jordi', 'Aina']} />);

    expect(screen.getByText('M')).toBeTruthy();
    expect(screen.getByText('J')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    expect(screen.queryByTestId('avatar-stack-extra')).toBeNull();
  });

  it('collapses overflow into a +N tail', async () => {
    await render(
      <AvatarStack names={['Marta', 'Jordi', 'Aina', 'Lucas', 'Pau', 'Clara', 'Toni']} max={5} />
    );

    expect(screen.getByTestId('avatar-stack-extra')).toHaveTextContent('+2');
  });

  it('renders the optional label', async () => {
    await render(<AvatarStack names={['Marta']} label="3 going · 2 pending" />);

    expect(screen.getByText('3 going · 2 pending')).toBeTruthy();
  });
});

describe('Avatar', () => {
  it('uppercases the first letter and survives empty names', async () => {
    await render(<Avatar name="marta" testID="a1" />);
    expect(screen.getByText('M')).toBeTruthy();

    await render(<Avatar name="  " testID="a2" />);
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('assigns the same color to the same name every time', () => {
    expect(colorForName('Marta')).toBe(colorForName('Marta'));
  });
});
