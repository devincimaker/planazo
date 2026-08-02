import { signOutOfAccount } from '../signOut';
import { forgetStoredSession, supabase } from '../supabase';
import { clearPushToken } from '../push';
import { useAuthStore } from '../../stores/authStore';

jest.mock('../supabase', () => ({
  supabase: { auth: { signOut: jest.fn() } },
  forgetStoredSession: jest.fn(),
}));
jest.mock('../push', () => ({ clearPushToken: jest.fn() }));

const mockSignOut = supabase.auth.signOut as unknown as jest.Mock;
const mockForget = forgetStoredSession as jest.Mock;
const mockClearPushToken = clearPushToken as jest.Mock;

const queryClient = { clear: jest.fn() } as any;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockSignOut.mockResolvedValue({ error: null });
  mockForget.mockResolvedValue(true);
  mockClearPushToken.mockResolvedValue(undefined);
  useAuthStore.setState({ session: { user: {} } as any, user: { id: 'user-1' } as any, profile: {} as any });
});

describe('signOutOfAccount', () => {
  it('clears the push token, the server, the device, then memory', async () => {
    expect(await signOutOfAccount('user-1', queryClient)).toBe(true);

    expect(mockClearPushToken).toHaveBeenCalledWith('user-1');
    expect(mockSignOut).toHaveBeenCalled();
    expect(mockForget).toHaveBeenCalled();
    expect(queryClient.clear).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
  });

  // The token has to go while the session can still authenticate the write, or
  // the old account keeps buzzing this device.
  it('drops the push token before the session that authorises it', async () => {
    const order: string[] = [];
    mockClearPushToken.mockImplementation(async () => void order.push('push'));
    mockSignOut.mockImplementation(async () => {
      order.push('signOut');
      return { error: null };
    });

    await signOutOfAccount('user-1', queryClient);

    expect(order).toEqual(['push', 'signOut']);
  });

  it('signs out anyway when the push token will not clear', async () => {
    mockClearPushToken.mockRejectedValue(new Error('offline'));

    expect(await signOutOfAccount('user-1', queryClient)).toBe(true);
    expect(mockForget).toHaveBeenCalled();
  });

  it('still drops the device credentials when supabase cannot reach /logout', async () => {
    mockSignOut.mockRejectedValue(new Error('offline'));

    expect(await signOutOfAccount('user-1', queryClient)).toBe(true);
    expect(mockForget).toHaveBeenCalled();
  });

  // The heart of it: credentials on disk mean the user is not signed out, and
  // clearing memory would put a login screen over a session that still exists.
  it('leaves memory alone and reports failure when the credentials survive', async () => {
    mockForget.mockResolvedValue(false);

    expect(await signOutOfAccount('user-1', queryClient)).toBe(false);

    expect(queryClient.clear).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).not.toBeNull();
  });

  it('still ends the session when there is no user to clear a token for', async () => {
    expect(await signOutOfAccount(undefined, queryClient)).toBe(true);

    expect(mockClearPushToken).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
  });
});
