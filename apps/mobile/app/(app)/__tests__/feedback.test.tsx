import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FeedbackScreen from '../feedback';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';
import { pickFromLibrary, uploadJpeg } from '../../../lib/images';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockDismiss = jest.fn();
let mockParams: Record<string, string | undefined> = {};

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../../lib/images', () => ({
  pickFromLibrary: jest.fn(),
  uploadJpeg: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, dismiss: mockDismiss }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: { View }, FadeInDown: {}, FadeOutUp: {}, LinearTransition: {} };
});

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0' } },
}));

jest.mock('expo-device', () => ({ modelName: 'iPhone 16 Pro' }));

const mockFrom = supabase.from as jest.Mock;
const mockPick = pickFromLibrary as jest.Mock;
const mockUpload = uploadJpeg as jest.Mock;

let feedbackInsert: jest.Mock;

function primeSupabase() {
  mockFrom.mockImplementation(() => {
    const c: any = {};
    c.insert = jest.fn(() => c);
    feedbackInsert = c.insert;
    c.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return c;
  });
}

async function renderFeedback() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <FeedbackScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  primeSupabase();
  useAuthStore.setState({ user: { id: 'me' } as any });
});

describe('FeedbackScreen', () => {
  it('Send is dead until there is a kind plus a note or attachment', async () => {
    await renderFeedback();

    await fireEvent.press(screen.getByTestId('send'));
    expect(mockFrom).not.toHaveBeenCalled();

    // A kind alone is not enough without an attachment
    await fireEvent.press(screen.getByTestId('kind-broken'));
    await fireEvent.press(screen.getByTestId('send'));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('kind + note sends and drops back through both sheets', async () => {
    await renderFeedback();

    await fireEvent.press(screen.getByTestId('kind-idea'));
    await fireEvent.changeText(
      screen.getByTestId('message-input'),
      'The date chips scroll under the Send button'
    );
    await fireEvent.press(screen.getByTestId('send'));

    await waitFor(() => {
      expect(feedbackInsert).toHaveBeenCalledWith({
        user_id: 'me',
        kind: 'idea',
        message: 'The date chips scroll under the Send button',
        screenshot_path: null,
        app_version: '1.0.0',
        device_model: 'iPhone 16 Pro',
      });
      expect(mockDismiss).toHaveBeenCalledWith(2);
    });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('a screenshot arrives pre-attached and makes Send live from the first tap', async () => {
    mockParams = { shot: 'file:///shot.jpg' };
    await renderFeedback();

    expect(screen.getByTestId('attachment')).toBeTruthy();
    expect(screen.getByText('the screen you were on')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('kind-broken'));
    await fireEvent.press(screen.getByTestId('send'));

    await waitFor(() => {
      expect(mockUpload).toHaveBeenCalledWith(
        'feedback-screenshots',
        expect.stringMatching(/^me\/\d+\.jpg$/),
        'file:///shot.jpg'
      );
      expect(feedbackInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'broken',
          screenshot_path: expect.stringMatching(/^me\/\d+\.jpg$/),
        })
      );
      expect(mockBack).toHaveBeenCalled();
    });
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it('dropping the attachment kills Send again', async () => {
    mockParams = { shot: 'file:///shot.jpg' };
    await renderFeedback();

    await fireEvent.press(screen.getByTestId('kind-broken'));
    await fireEvent.press(screen.getByTestId('remove-attachment'));
    expect(screen.queryByTestId('attachment')).toBeNull();

    await fireEvent.press(screen.getByTestId('send'));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('Add photo attaches from the library', async () => {
    mockPick.mockResolvedValue('file:///library.jpg');
    await renderFeedback();

    await fireEvent.press(screen.getByTestId('add-photo'));
    await waitFor(() => {
      expect(screen.getByTestId('attachment')).toBeTruthy();
    });
  });
});
