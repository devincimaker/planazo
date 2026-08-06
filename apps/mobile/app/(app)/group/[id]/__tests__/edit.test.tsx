import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import EditGroupScreen from '../edit';
import { supabase } from '../../../../../lib/supabase';
import { pickFromLibrary, uploadGroupPhoto, removeGroupPhoto } from '../../../../../lib/images';
import { colorForName } from '../../../../../components/ui';
import { chooseFromSheet, mockActionSheet } from '../../../../../lib/testing/actionSheet';

const mockBack = jest.fn();

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../../../../lib/images', () => ({
  pickFromLibrary: jest.fn(),
  takePhoto: jest.fn(),
  uploadGroupPhoto: jest.fn(),
  removeGroupPhoto: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));


const mockFrom = supabase.from as jest.Mock;
const mockPick = pickFromLibrary as jest.Mock;
const mockUpload = uploadGroupPhoto as jest.Mock;
const mockRemove = removeGroupPhoto as jest.Mock;

interface GroupRow {
  id: string;
  name: string;
  color: string | null;
  image_url: string | null;
}

const PHOTO_URL = 'https://cdn.example/group-images/g1/cover.jpg?t=1';
const NO_PHOTO: GroupRow = { id: 'g1', name: 'Padel Dilluns', color: '#F6C453', image_url: null };
const WITH_PHOTO: GroupRow = { ...NO_PHOTO, image_url: 'https://cdn.example/old.jpg' };
/** Never picked a colour, so every screen derives one from the name. */
const NO_COLOUR: GroupRow = { ...NO_PHOTO, color: null };

let groupUpdate: jest.Mock;

function primeSupabase(group: GroupRow) {
  // One spy across every from() call. Saving invalidates the query, so the
  // refetch builds another chain, and a per-chain spy would be a fresh empty
  // one by the time the assertion runs.
  groupUpdate = jest.fn();
  mockFrom.mockImplementation(() => {
    const c: any = {};
    ['select', 'eq'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.single = jest.fn(() => Promise.resolve({ data: group, error: null }));
    c.update = jest.fn((u: Record<string, unknown>) => {
      groupUpdate(u);
      return c;
    });
    c.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return c;
  });
}

async function renderEdit(group = NO_PHOTO) {
  primeSupabase(group);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  await render(
    <QueryClientProvider client={client}>
      <EditGroupScreen />
    </QueryClientProvider>
  );
  await screen.findByDisplayValue(group.name);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockActionSheet();
  mockUpload.mockResolvedValue(PHOTO_URL);
});

describe('Group profile', () => {
  it('Save stays grey until something actually changed', async () => {
    await renderEdit();

    await fireEvent.press(screen.getByTestId('save'));
    expect(groupUpdate).not.toHaveBeenCalled();
  });

  it('offers the colour while the tile is still a letter', async () => {
    await renderEdit();

    expect(screen.getByText('Colour')).toBeTruthy();
    expect(screen.getByText('Add a photo')).toBeTruthy();
  });

  // The colour is still stored and still drives the feed stripe. It just has
  // no job on a tile the photo has taken over.
  it('hides the colour once a photo is set, and says why', async () => {
    await renderEdit(WITH_PHOTO);

    expect(screen.queryByText('Colour')).toBeNull();
    expect(
      screen.getByText('Colour is hidden while a photo is set. It comes back the moment the photo goes.')
    ).toBeTruthy();
  });

  it('uploads on save, not on pick', async () => {
    mockPick.mockResolvedValue('file:///picked.jpg');
    await renderEdit();

    await fireEvent.press(screen.getByTestId('add-photo'));
    await chooseFromSheet(1);
    expect(mockUpload).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith('g1', 'file:///picked.jpg');
    });
    // Reaching this at all proves picking a photo made the screen dirty on its
    // own: Save is inert otherwise.
    expect(groupUpdate).toHaveBeenCalledWith({
      name: 'Padel Dilluns',
      color: '#F6C453',
      image_url: PHOTO_URL,
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('removing clears the row before it deletes the object', async () => {
    await renderEdit(WITH_PHOTO);

    await fireEvent.press(screen.getByTestId('remove-photo'));
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() => {
      expect(groupUpdate).toHaveBeenCalledWith({
        name: 'Padel Dilluns',
        color: '#F6C453',
        image_url: null,
      });
    });
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('g1'));
    expect(mockUpload).not.toHaveBeenCalled();
  });

  // An orphaned object is untidy; a row pointing at a deleted one is a broken
  // tile on every screen. So a failed delete must not fail the save.
  it('still saves when the object delete fails', async () => {
    mockRemove.mockRejectedValue(new Error('storage down'));
    await renderEdit(WITH_PHOTO);

    await fireEvent.press(screen.getByTestId('remove-photo'));
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  // create_group assigns color_for_name() so production rows always have one,
  // but legacy rows and anything inserted straight through the service role
  // (seed-demo-data.mjs) do not. The editor used to fall back to a fixed
  // swatch for those, so saving anything at all repainted the group — and once
  // a photo hides the swatches, invisibly.
  describe('a group that never picked a colour', () => {
    it('keeps the colour every other screen already shows for it', async () => {
      mockPick.mockResolvedValue('file:///picked.jpg');
      await renderEdit(NO_COLOUR);

      await fireEvent.press(screen.getByTestId('add-photo'));
      await chooseFromSheet(1);
      await fireEvent.press(screen.getByTestId('save'));

      await waitFor(() => {
        expect(groupUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ color: colorForName('Padel Dilluns') })
        );
      });
    });

    // The dirty check reads the same fallback, so a mismatch would light Save
    // up on open and offer to save a change nobody made.
    it('does not open already dirty', async () => {
      await renderEdit(NO_COLOUR);

      await fireEvent.press(screen.getByTestId('save'));
      expect(groupUpdate).not.toHaveBeenCalled();
    });
  });

  it('renaming alone leaves the photo untouched', async () => {
    await renderEdit(WITH_PHOTO);

    await fireEvent.changeText(screen.getByTestId('name-input'), 'Padel Dimarts');
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() => {
      expect(groupUpdate).toHaveBeenCalledWith({
        name: 'Padel Dimarts',
        color: '#F6C453',
      });
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});
