import { StyleSheet, type ViewStyle } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { GroupPhotoField } from '../GroupPhotoField';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { pickFromLibrary, takePhoto } from '../../../lib/images';
import { chooseFromSheet, mockActionSheet, sheetOptions } from '../../../lib/testing/actionSheet';

jest.mock('../../../lib/images', () => ({
  pickFromLibrary: jest.fn(),
  takePhoto: jest.fn(),
}));

const mockPick = pickFromLibrary as jest.Mock;
const mockCamera = takePhoto as jest.Mock;

const PHOTO = 'file:///picked.jpg';
const CAPTION = 'The photo is the group’s tile everywhere.';

async function renderField(props: Partial<React.ComponentProps<typeof GroupPhotoField>> = {}) {
  const onPick = jest.fn();
  const onRemove = jest.fn();
  await render(
    <GroupPhotoField caption={CAPTION} onPick={onPick} onRemove={onRemove} {...props} />
  );
  return { onPick, onRemove };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActionSheet();
});

describe('GroupPhotoField', () => {
  it('offers the photo without pushing it, since the letter is the default', async () => {
    await renderField();

    expect(screen.getByText('Add a photo')).toBeTruthy();
    expect(screen.getByText('Optional. Without one the group keeps its letter.')).toBeTruthy();
    expect(screen.queryByTestId('remove-photo')).toBeNull();
  });

  it('has nothing to undo before a photo exists', async () => {
    await renderField();

    await fireEvent.press(screen.getByTestId('add-photo'));
    expect(sheetOptions()).toEqual(['Take a photo', 'Choose from library', 'Cancel']);
  });

  it('offers the letter back once a photo is set', async () => {
    await renderField({ uri: PHOTO });

    await fireEvent.press(screen.getByTestId('change-photo'));
    expect(sheetOptions()).toEqual([
      'Take a photo',
      'Choose from library',
      'Use the letter instead',
      'Cancel',
    ]);
  });

  it('hands the picked library image back to the screen', async () => {
    mockPick.mockResolvedValue(PHOTO);
    const { onPick } = await renderField();

    await fireEvent.press(screen.getByTestId('add-photo'));
    await chooseFromSheet(1);

    expect(onPick).toHaveBeenCalledWith(PHOTO);
  });

  it('hands a camera shot back the same way', async () => {
    mockCamera.mockResolvedValue(PHOTO);
    const { onPick } = await renderField();

    await fireEvent.press(screen.getByTestId('add-photo'));
    await chooseFromSheet(0);

    expect(onPick).toHaveBeenCalledWith(PHOTO);
  });

  it('says nothing happened when the picker is cancelled', async () => {
    mockPick.mockResolvedValue(null);
    const { onPick } = await renderField();

    await fireEvent.press(screen.getByTestId('add-photo'));
    await chooseFromSheet(1);

    expect(onPick).not.toHaveBeenCalled();
  });

  it('removes from the row or from the sheet', async () => {
    const { onRemove } = await renderField({ uri: PHOTO });

    await fireEvent.press(screen.getByTestId('remove-photo'));
    expect(onRemove).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('change-photo'));
    await chooseFromSheet(2);
    expect(onRemove).toHaveBeenCalledTimes(2);
  });

  it('shows the caption the screen gave it', async () => {
    await renderField({ uri: PHOTO });

    expect(screen.getByText(CAPTION)).toBeTruthy();
  });

  // PLA-40's floor, asserted the same way touchTargets.test.tsx does it. It
  // lives here rather than in that suite because this component reaches
  // lib/images, and that suite is deliberately mock-free.
  it('gives every control the 44pt minimum', async () => {
    const floorOf = (style: unknown) =>
      ((StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle).minHeight;

    await renderField();
    expect(floorOf(screen.getByTestId('add-photo').props.style)).toBeGreaterThanOrEqual(
      MIN_TOUCH_TARGET
    );

    // Change and Remove are 20pt words that claim 44 and hand the surplus back
    // with a negative margin, so the row does not grow.
    await renderField({ uri: PHOTO });
    for (const id of ['change-photo', 'remove-photo']) {
      expect(floorOf(screen.getByTestId(id).props.style)).toBeGreaterThanOrEqual(
        MIN_TOUCH_TARGET
      );
    }
  });

  // Nothing to change or remove while it is in flight, and no invented percentage.
  it('goes quiet while the photo is uploading', async () => {
    await renderField({ uri: PHOTO, uploading: true });

    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByTestId('change-photo')).toBeNull();
    expect(screen.queryByTestId('remove-photo')).toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
