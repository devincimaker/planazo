import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileSheet from '../index';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(() => Promise.resolve({ error: null })),
    auth: { signOut: jest.fn(() => Promise.resolve({ error: null })) },
  },
}));

const mockClearPushToken: jest.Mock = jest.fn(() => Promise.resolve());
jest.mock('../../../../lib/push', () => ({
  clearPushToken: (...args: unknown[]) => mockClearPushToken(...args),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
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

const mockFrom = supabase.from as jest.Mock;

const ME = {
  id: 'me',
  email: 'rovidal@gmail.com',
  display_name: 'Rocío Vidal',
  handle: 'rovidal',
  avatar_url: null,
  add_to_calendar: false,
  push_enabled: true,
};

let profileUpdate: jest.Mock;

function primeSupabase() {
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    ['select', 'eq', 'single'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    let updates: Record<string, unknown> | null = null;
    c.update = jest.fn((u: Record<string, unknown>) => {
      updates = u;
      return c;
    });
    if (table === 'profiles') profileUpdate = c.update;
    c.then = (resolve: (v: unknown) => void) => {
      const result =
        table === 'group_members'
          ? { count: 3, error: null }
          : { data: { ...ME, ...(updates ?? {}) }, error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfileSheet />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  primeSupabase();
  useAuthStore.setState({ user: { id: 'me' } as any, profile: { ...ME } as any });
});

describe('ProfileSheet', () => {
  it('shows who you are, read-only, with the version under the feedback row', async () => {
    await renderSheet();

    expect(screen.getByText('Rocío Vidal')).toBeTruthy();
    expect(await screen.findByText('@rovidal · in 3 groups')).toBeTruthy();
    expect(screen.getByText('rovidal@gmail.com')).toBeTruthy();
    expect(screen.getByText('Send feedback')).toBeTruthy();
    expect(screen.getByText('Broken thing, or an idea — takes 10 seconds')).toBeTruthy();
    expect(screen.getByText('Planazo 1.0.0')).toBeTruthy();
  });

  it('the edit button is the only way in and opens the edit screen', async () => {
    await renderSheet();

    await fireEvent.press(screen.getByTestId('edit-profile'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/profile/edit');
  });

  it('the feedback row opens the compose sheet', async () => {
    await renderSheet();

    await fireEvent.press(screen.getByTestId('send-feedback'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/feedback');
  });

  it('flipping the Notify me toggle persists it to the profile', async () => {
    await renderSheet();

    await fireEvent(screen.getByTestId('pref-push'), 'valueChange', false);

    await waitFor(() => {
      expect(profileUpdate).toHaveBeenCalledWith({ push_enabled: false });
    });
    await waitFor(() => {
      expect(useAuthStore.getState().profile?.push_enabled).toBe(false);
    });
  });

  it('flipping the calendar toggle persists it to the profile', async () => {
    await renderSheet();

    await fireEvent(screen.getByTestId('pref-calendar'), 'valueChange', true);

    await waitFor(() => {
      expect(profileUpdate).toHaveBeenCalledWith({ add_to_calendar: true });
    });
    await waitFor(() => {
      expect(useAuthStore.getState().profile?.add_to_calendar).toBe(true);
    });
  });

  it('sign out confirms first, then clears the session', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(alertSpy).toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const confirm = buttons.find((b) => b.text === 'Sign out');
    await confirm?.onPress?.();

    await waitFor(() => {
      expect(mockClearPushToken).toHaveBeenCalledWith('me');
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
    });
  });

  // App Store Review 5.1.1(v): deleting the account has to be reachable from
  // inside the app, and it must not be one stray tap away either.
  it('deleting the account asks twice before it calls the RPC', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('delete-account'));

    const first = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await first.find((b) => b.text === 'Delete')?.onPress?.();
    expect(supabase.rpc).not.toHaveBeenCalled();

    const second = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await second.find((b) => b.text === 'Delete for good')?.onPress?.();

    await waitFor(() => {
      expect(supabase.rpc).toHaveBeenCalledWith('delete_my_account');
      expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
    });
  });

  it('backing out of either confirmation leaves the account alone', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('delete-account'));
    const first = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await first.find((b) => b.text === 'Cancel')?.onPress?.();

    await fireEvent.press(screen.getByTestId('delete-account'));
    const reopened = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await reopened.find((b) => b.text === 'Delete')?.onPress?.();
    const second = alertSpy.mock.calls[2][2] as { text: string; onPress?: () => void }[];
    await second.find((b) => b.text === 'Keep my account')?.onPress?.();

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('keeps the user signed in when the delete fails', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      error: { message: 'network is down' },
    });
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('delete-account'));
    const first = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await first.find((b) => b.text === 'Delete')?.onPress?.();
    const second = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await second.find((b) => b.text === 'Delete for good')?.onPress?.();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Couldn't delete your account", 'network is down');
    });
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
