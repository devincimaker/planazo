import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReportScreen from '../report';
import { useAuthStore } from '../../../stores/authStore';

const mockBack = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));

// moderation.ts pulls in the real client otherwise, which wants env vars.
jest.mock('../../../lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const mockSubmitReport: jest.Mock = jest.fn(() => Promise.resolve());
jest.mock('../../../lib/moderation', () => {
  const actual = jest.requireActual('../../../lib/moderation');
  return {
    ...actual,
    submitReport: (...args: unknown[]) => mockSubmitReport(...args),
  };
});

// Mock the Toast module itself, not the barrel — the barrel re-exports from
// here, so this reaches the screen without rebuilding every other component.
const mockShowToast: jest.Mock = jest.fn();
jest.mock('../../../components/ui/Toast', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
  ToastHost: () => null,
}));


jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: { View }, FadeInDown: {}, FadeOutUp: {}, LinearTransition: {} };
});

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { type: 'plan', id: 'plan-1', subject: 'Asado', personId: 'bob', personName: 'Bob' };
  useAuthStore.setState({ user: { id: 'me' } as any, profile: { id: 'me' } as any });
});

describe('ReportScreen', () => {
  it('will not send until a reason is picked', async () => {
    const view = await renderScreen();

    await fireEvent.press(view.getByTestId('send-report'));
    expect(mockSubmitReport).not.toHaveBeenCalled();

    await fireEvent.press(view.getByTestId('reason-spam'));
    await fireEvent.press(view.getByTestId('send-report'));

    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectType: 'plan',
          subjectId: 'plan-1',
          reason: 'spam',
        })
      )
    );
  });

  it('does not block anybody unless asked to', async () => {
    const view = await renderScreen();

    await fireEvent.press(view.getByTestId('reason-harassment'));
    await fireEvent.press(view.getByTestId('send-report'));

    await waitFor(() => expect(mockSubmitReport).toHaveBeenCalled());
    expect(mockSubmitReport).toHaveBeenCalledWith(
      expect.objectContaining({ blockUserId: null })
    );
    expect(mockBack).toHaveBeenCalled();
  });

  // The block travels inside the same call as the report — file_report is one
  // transaction, so a retry after a failure can never file the report twice.
  it('blocks the author too when the toggle is on', async () => {
    const view = await renderScreen();

    await fireEvent.press(view.getByTestId('reason-harassment'));
    await fireEvent(view.getByTestId('also-block'), 'valueChange', true);
    await fireEvent.press(view.getByTestId('send-report'));

    await waitFor(() =>
      expect(mockSubmitReport).toHaveBeenCalledWith(
        expect.objectContaining({ blockUserId: 'bob' })
      )
    );
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining('Bob'));
  });

  // Reporting your own plan is a thing people do by accident; offering to
  // block yourself would be nonsense.
  it('hides the block toggle when the author is you', async () => {
    mockParams = { type: 'plan', id: 'plan-1', subject: 'Asado', personId: 'me', personName: 'Me' };
    const view = await renderScreen();

    expect(view.queryByTestId('also-block')).toBeNull();
  });

  it('hides the block toggle when there is no person behind it', async () => {
    mockParams = { type: 'group', id: 'group-1', subject: 'Fútbol' };
    const view = await renderScreen();

    expect(view.queryByTestId('also-block')).toBeNull();
    expect(view.getByText('Report group')).toBeTruthy();
  });

  it('keeps the screen open when sending fails', async () => {
    mockSubmitReport.mockRejectedValueOnce(new Error('offline'));
    const view = await renderScreen();

    await fireEvent.press(view.getByTestId('reason-spam'));
    await fireEvent.press(view.getByTestId('send-report'));

    await waitFor(() => expect(mockSubmitReport).toHaveBeenCalled());
    expect(mockBack).not.toHaveBeenCalled();
  });
});
