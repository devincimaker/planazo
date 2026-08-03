import { render, screen, fireEvent } from '@testing-library/react-native';
import { GroupTile, groupInitial } from '../GroupTile';
import { colorForName } from '../Avatar';

const PHOTO = 'https://cdn.example.com/group-images/g1/cover.jpg?t=1';

describe('GroupTile', () => {
  it('is the letter on the group colour when there is no photo', async () => {
    await render(<GroupTile name="Padel Dilluns" color="#F6C453" testID="tile" />);

    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.queryByTestId('tile-image')).toBeNull();
    expect(screen.getByTestId('tile')).toHaveStyle({ backgroundColor: '#F6C453' });
  });

  it('falls back to the name hash for rows saved before colours existed', async () => {
    await render(<GroupTile name="Weekend Crew" testID="tile" />);

    expect(screen.getByTestId('tile')).toHaveStyle({
      backgroundColor: colorForName('Weekend Crew'),
    });
  });

  it('shows the photo instead of the letter once one is set', async () => {
    await render(<GroupTile name="Padel Dilluns" color="#F6C453" imageUrl={PHOTO} testID="tile" />);

    expect(screen.getByTestId('tile-image').props.source).toEqual({ uri: PHOTO });
    expect(screen.queryByText('P')).toBeNull();
  });

  // The photo covers the tile edge to edge, so a colour behind it would only
  // ever show through a transparent PNG.
  it('drops the colour behind a photo', async () => {
    await render(<GroupTile name="Padel Dilluns" color="#F6C453" imageUrl={PHOTO} testID="tile" />);

    expect(screen.getByTestId('tile')).toHaveStyle({ backgroundColor: 'transparent' });
  });

  // A dead URL used to leave a tile with no photo, no colour and no letter.
  it('falls back to the letter when the photo will not load', async () => {
    await render(<GroupTile name="Padel Dilluns" color="#F6C453" imageUrl={PHOTO} testID="tile" />);

    await fireEvent(screen.getByTestId('tile-image'), 'error');

    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.queryByTestId('tile-image')).toBeNull();
    expect(screen.getByTestId('tile')).toHaveStyle({ backgroundColor: '#F6C453' });
  });

  it('tries again when a different photo arrives', async () => {
    const { rerender } = await render(
      <GroupTile name="Padel Dilluns" color="#F6C453" imageUrl={PHOTO} testID="tile" />
    );
    await fireEvent(screen.getByTestId('tile-image'), 'error');
    expect(screen.queryByTestId('tile-image')).toBeNull();

    await rerender(
      <GroupTile name="Padel Dilluns" color="#F6C453" imageUrl={`${PHOTO}&v=2`} testID="tile" />
    );

    expect(screen.getByTestId('tile-image')).toBeTruthy();
  });

  it('keeps the photo inside the squircle at every size', async () => {
    await render(<GroupTile name="Padel" imageUrl={PHOTO} size={52} testID="tile" />);

    // 52 * 0.32 = 16.64, and the design's identity row asks for 17.
    expect(screen.getByTestId('tile')).toHaveStyle({ borderRadius: 17, overflow: 'hidden' });
    expect(screen.getByTestId('tile-image').props.style).toMatchObject({ borderRadius: 17 });
  });
});

describe('groupInitial', () => {
  it('drops a leading article rather than tiling every group with L', () => {
    expect(groupInitial('La banda')).toBe('B');
    expect(groupInitial('Los amigos')).toBe('A');
  });

  // Only words of 1-2 letters are skipped, so "del" is a word like any other.
  it('takes the first word long enough to count', () => {
    expect(groupInitial('Los del fulbito')).toBe('D');
    expect(groupInitial('el eq')).toBe('E');
  });
});
