import { Alert, Linking } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfileSheet from '../index';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';
import { signOutOfAccount } from '../../../../lib/signOut';

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
const mockRegisterPushToken: jest.Mock = jest.fn(() => Promise.resolve());
jest.mock('../../../../lib/push', () => ({
  clearPushToken: (...args: unknown[]) => mockClearPushToken(...args),
  registerPushToken: (...args: unknown[]) => mockRegisterPushToken(...args),
}));

// Clean by default; individual tests make it fail.
const mockPurgeOwnedFiles: jest.Mock = jest.fn(() => Promise.resolve({ failed: [] }));
jest.mock('../../../../lib/signOut', () => ({
  signOutOfAccount: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../../../lib/storage', () => ({
  purgeOwnedFiles: (...args: unknown[]) => mockPurgeOwnedFiles(...args),
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

  // The privacy policy claims the device token goes when you turn
  // notifications off. Flipping a boolean alone would leave that a lie.
  it('turning Notify me off clears the device token, and on re-registers it', async () => {
    await renderSheet();

    await fireEvent(screen.getByTestId('pref-push'), 'valueChange', false);
    await waitFor(() => expect(mockClearPushToken).toHaveBeenCalledWith('me'));
    expect(mockRegisterPushToken).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId('pref-push'), 'valueChange', true);
    await waitFor(() => expect(mockRegisterPushToken).toHaveBeenCalledWith('me'));
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
      expect(signOutOfAccount).toHaveBeenCalledWith('me', expect.anything());
      expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
    });
  });

  // Credentials still on disk mean the user is not signed out, so a login
  // screen here would be undone by the very next launch (PLA-36).
  it('says so, and stays put, when the credentials would not delete', async () => {
    (signOutOfAccount as jest.Mock).mockResolvedValueOnce(false);
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('sign-out'));
    const buttons = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await buttons.find((b) => b.text === 'Sign out')?.onPress?.();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith("Couldn't sign out", expect.stringMatching(/still signed in/i));
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // Guideline 5.1.1(i): the policy has to be reachable from inside the app,
  // not only from the store listing.
  it.each([
    ['privacy-link', 'https://planazo.me/privacy'],
    ['terms-link', 'https://planazo.me/terms'],
    ['support-link', 'https://planazo.me/support'],
  ])('opens %s', async (testID, url) => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    await renderSheet();

    await fireEvent.press(screen.getByTestId(testID));

    expect(openSpy).toHaveBeenCalledWith(url);
    openSpy.mockRestore();
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
      expect(signOutOfAccount).toHaveBeenCalled();
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

  // The avatars bucket is public, so a file left behind outlives the account
  // that owned it with nobody able to remove it. Refuse rather than orphan.
  it('refuses to delete the account while files are still in storage', async () => {
    mockPurgeOwnedFiles.mockResolvedValueOnce({ failed: ['avatars'] });
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('delete-account'));
    const first = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await first.find((b) => b.text === 'Delete')?.onPress?.();
    const second = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await second.find((b) => b.text === 'Delete for good')?.onPress?.();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Couldn't delete your account",
        expect.stringContaining('online for good'),
      );
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('purges storage before it deletes the account, not after', async () => {
    const order: string[] = [];
    mockPurgeOwnedFiles.mockImplementationOnce(() => {
      order.push('purge');
      return Promise.resolve({ failed: [] });
    });
    (supabase.rpc as jest.Mock).mockImplementationOnce(() => {
      order.push('rpc');
      return Promise.resolve({ error: null });
    });
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('delete-account'));
    const first = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await first.find((b) => b.text === 'Delete')?.onPress?.();
    const second = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await second.find((b) => b.text === 'Delete for good')?.onPress?.();

    // Once the account is gone the session can no longer satisfy the storage
    // policies, so this order is the whole reason the purge works at all.
    await waitFor(() => expect(order).toEqual(['purge', 'rpc']));
    expect(mockPurgeOwnedFiles).toHaveBeenCalledWith('me');
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
    expect(signOutOfAccount).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  // The account is gone server-side, so a token left on the device would let
  // the next launch restore a session for a user that no longer exists.
  it('says the account is deleted but the device is not signed out', async () => {
    (signOutOfAccount as jest.Mock).mockResolvedValueOnce(false);
    const alertSpy = jest.spyOn(Alert, 'alert');
    await renderSheet();

    await fireEvent.press(screen.getByTestId('delete-account'));
    const first = alertSpy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await first.find((b) => b.text === 'Delete')?.onPress?.();
    const second = alertSpy.mock.calls[1][2] as { text: string; onPress?: () => void }[];
    await second.find((b) => b.text === 'Delete for good')?.onPress?.();

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Your account is deleted',
        expect.stringMatching(/signed out on this device/i)
      );
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
