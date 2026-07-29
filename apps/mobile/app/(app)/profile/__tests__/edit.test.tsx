import { ActionSheetIOS } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileEdit from '../edit';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';
import { pickFromLibrary, uploadJpeg } from '../../../../lib/images';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

jest.mock('../../../../lib/images', () => ({
  pickFromLibrary: jest.fn(),
  takePhoto: jest.fn(),
  uploadJpeg: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: { View }, FadeInDown: {}, FadeOutUp: {}, LinearTransition: {} };
});

const mockFrom = supabase.from as jest.Mock;
const mockStorageFrom = supabase.storage.from as jest.Mock;
const mockPick = pickFromLibrary as jest.Mock;
const mockUpload = uploadJpeg as jest.Mock;

const ME = {
  id: 'me',
  email: 'rovidal@gmail.com',
  display_name: 'Rocío Vidal',
  handle: 'rovidal',
  avatar_url: 'https://cdn.example/me/avatar.jpg',
  add_to_calendar: false,
};

let profileUpdate: jest.Mock;

function primeSupabase() {
  mockFrom.mockImplementation(() => {
    const c: any = {};
    ['select', 'eq', 'single'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    let updates: Record<string, unknown> | null = null;
    c.update = jest.fn((u: Record<string, unknown>) => {
      updates = u;
      return c;
    });
    profileUpdate = c.update;
    c.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: { ...ME, ...(updates ?? {}) }, error: null }).then(resolve);
    return c;
  });
  mockStorageFrom.mockReturnValue({
    getPublicUrl: jest.fn(() => ({ data: { publicUrl: 'https://cdn.example/me/avatar.jpg' } })),
  });
}

async function renderEdit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileEdit />
    </QueryClientProvider>
  );
}

async function chooseFromPhotoSheet(index: number) {
  const sheetSpy = ActionSheetIOS.showActionSheetWithOptions as jest.Mock;
  const callback = sheetSpy.mock.calls[0][1] as (i: number) => void;
  await act(async () => {
    callback(index);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  primeSupabase();
  useAuthStore.setState({ user: { id: 'me' } as any, profile: { ...ME } as any });
});

describe('ProfileEdit', () => {
  it('Save stays grey until something actually changed', async () => {
    await renderEdit();

    await fireEvent.press(screen.getByTestId('save'));
    expect(mockFrom).not.toHaveBeenCalled();

    // Retyping the same name is not a change either
    await fireEvent.changeText(screen.getByTestId('name-input'), 'Rocío Vidal');
    await fireEvent.press(screen.getByTestId('save'));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('a real rename saves, updates the store and closes', async () => {
    await renderEdit();

    await fireEvent.changeText(screen.getByTestId('name-input'), 'Ro Vidal');
    await fireEvent.press(screen.getByTestId('save'));

    await waitFor(() => {
      expect(profileUpdate).toHaveBeenCalledWith({ display_name: 'Ro Vidal' });
      expect(useAuthStore.getState().profile?.display_name).toBe('Ro Vidal');
      expect(mockBack).toHaveBeenCalled();
    });
  });

  it('the handle is shown but fixed', async () => {
    await renderEdit();

    expect(
      screen.getByText(/Your handle @rovidal can't change — invite links point at it/)
    ).toBeTruthy();
  });

  it('"Use my initial instead" clears the photo on save', async () => {
    await renderEdit();

    await fireEvent.press(screen.getByTestId('avatar-press'));
    expect(ActionSheetIOS.showActionSheetWithOptions).toHaveBeenCalled();
    await chooseFromPhotoSheet(2);

    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => {
      expect(profileUpdate).toHaveBeenCalledWith({ avatar_url: null });
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('choosing from the library uploads on save, not on pick', async () => {
    mockPick.mockResolvedValue('file:///picked.jpg');
    await renderEdit();

    await fireEvent.press(screen.getByTestId('change-photo'));
    await chooseFromPhotoSheet(1);
    expect(mockUpload).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('save'));
    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith('avatars', 'me/avatar.jpg', 'file:///picked.jpg', true);
      expect(profileUpdate).toHaveBeenCalledWith({
        avatar_url: expect.stringContaining('https://cdn.example/me/avatar.jpg?t='),
      });
    });
  });
});
