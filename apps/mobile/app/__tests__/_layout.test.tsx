import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import RootLayout from '../_layout';
import { useAuthStore } from '../../stores/authStore';
import { forgetStoredSession, supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signOut: jest.fn(),
      onAuthStateChange: jest.fn(),
    },
    from: jest.fn(),
  },
  forgetStoredSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Slot: () => React.createElement(Text, { testID: 'slot' }, 'app'),
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useRootNavigationState: () => ({ key: 'root' }),
  };
});

jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('../../lib/push', () => ({
  initNotificationPresentation: jest.fn(),
  registerPushToken: jest.fn().mockResolvedValue(undefined),
}));

const mockGetSession = supabase.auth.getSession as unknown as jest.Mock;
const mockSignOut = supabase.auth.signOut as unknown as jest.Mock;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as unknown as jest.Mock;
const mockFrom = supabase.from as jest.Mock;
const mockForget = forgetStoredSession as jest.Mock;

const SESSION = { access_token: 'token', user: { id: 'user-1' } } as any;
const PROFILE = { id: 'user-1', display_name: 'Marta' };

/**
 * What the profile query actually returns when the host never answers:
 * postgrest-js flattens our fetch wrapper's error and folds the class name into
 * the message.
 */
const unreachable = {
  message: 'Error: Failed to reach Supabase at http://127.0.0.1:55321/rest/v1/profiles.',
  details: 'at fetch (…)',
  hint: '',
  code: '',
};
/** What GoTrue hands back once it has re-wrapped that same failure. */
const wrappedUnreachable = Object.assign(
  new Error('Failed to reach Supabase at https://x.supabase.co/auth/v1/token.'),
  { name: 'AuthRetryableFetchError', status: 0, __isAuthError: true }
);
/** A refresh token the server read and refused. */
const rejectedToken = Object.assign(new Error('Invalid Refresh Token'), {
  name: 'AuthApiError',
  status: 400,
  __isAuthError: true,
});
/** A revoked session — `session_not_found`, which arrives under its own class. */
const revokedSession = Object.assign(new Error('Auth session missing!'), {
  name: 'AuthSessionMissingError',
  status: 400,
  __isAuthError: true,
});

/** Stubs `.from('profiles').select('*').eq('id', id).single()`. */
const profileQuery = (result: unknown) => ({
  select: () => ({ eq: () => ({ single: () => Promise.resolve(result) }) }),
});

/** Fires an auth event the way supabase-js would, into the mounted listener. */
let emitAuthEvent: (event: string, session: unknown) => void;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  useAuthStore.setState({
    session: null,
    user: null,
    profile: null,
    isLoading: true,
    isInitialized: false,
  });

  mockSignOut.mockResolvedValue({ error: null });
  mockOnAuthStateChange.mockImplementation((callback: typeof emitAuthEvent) => {
    emitAuthEvent = callback;
    return { data: { subscription: { unsubscribe: jest.fn() } } };
  });
});

describe('launching with no connectivity (PLA-36)', () => {
  it('keeps the session and offers a retry when the profile fetch cannot land', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    mockFrom.mockReturnValue(profileQuery({ data: null, error: unreachable }));

    await render(<RootLayout />);

    expect(await screen.findByTestId('init-error')).toBeTruthy();
    expect(screen.getByText("Couldn't reach Planazo")).toBeTruthy();
    // The whole bug: a blip used to end here, with the session destroyed and
    // the login screen asking for a password again.
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBe(SESSION);
    expect(screen.queryByTestId('slot')).toBeNull();
  });

  it('keeps the session when the token refresh itself cannot reach the server', async () => {
    // GoTrue returns a null session AND a retryable error here — it has
    // deliberately left the stored session on disk. Reading only the null is
    // what used to bounce the user to login.
    mockGetSession.mockResolvedValue({ data: { session: null }, error: wrappedUnreachable });

    await render(<RootLayout />);

    expect(await screen.findByTestId('init-error')).toBeTruthy();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('gets to the feed on retry once the connection returns, with no sign-in', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    mockFrom
      .mockReturnValueOnce(profileQuery({ data: null, error: unreachable }))
      .mockReturnValue(profileQuery({ data: PROFILE, error: null }));

    await render(<RootLayout />);
    fireEvent.press(await screen.findByTestId('init-error-retry'));

    expect(await screen.findByTestId('slot')).toBeTruthy();
    expect(useAuthStore.getState().profile).toEqual(PROFILE);
    expect(useAuthStore.getState().session).toBe(SESSION);
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  // Nothing to retry back into, and a sign-out could not reach the server to
  // stick anyway — offering one would be a button that lies.
  it('offers no sign-out on a transport failure', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    mockFrom.mockReturnValue(profileQuery({ data: null, error: unreachable }));

    await render(<RootLayout />);

    await screen.findByTestId('init-error');
    expect(screen.queryByTestId('init-error-back')).toBeNull();
  });
});

describe('launching with a session the server refuses', () => {
  it('signs out locally and lets the app route to login', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: rejectedToken });

    await render(<RootLayout />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(await screen.findByTestId('slot')).toBeTruthy();
    expect(useAuthStore.getState().session).toBeNull();
    expect(screen.queryByTestId('init-error')).toBeNull();
  });

  // A revoked session arrives as AuthSessionMissingError, and supabase-js has
  // already dropped it — so a retry screen here could never come good.
  it('treats a revoked session as dead rather than retryable', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: revokedSession });

    await render(<RootLayout />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(await screen.findByTestId('slot')).toBeTruthy();
    expect(screen.queryByTestId('init-error')).toBeNull();
  });

  // supabase-js returns early without clearing storage when its /logout call
  // fails, so trusting it would show the login screen while the credentials
  // sat on disk, ready to sign the user back in on the next launch.
  it('drops the stored session even when supabase says the sign-out failed', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: rejectedToken });
    mockSignOut.mockResolvedValue({ error: wrappedUnreachable });

    await render(<RootLayout />);

    await waitFor(() => expect(mockForget).toHaveBeenCalled());
    expect(useAuthStore.getState().session).toBeNull();
  });

  it('drops the stored session even when the sign-out throws outright', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: rejectedToken });
    mockSignOut.mockRejectedValue(new Error('boom'));

    await render(<RootLayout />);

    await waitFor(() => expect(mockForget).toHaveBeenCalled());
    expect(useAuthStore.getState().session).toBeNull();
  });

  // A missing profile row is a data problem, not a credentials one. Retrying is
  // the first offer, but signing out has to stay reachable or the user is stuck
  // on a screen only a reinstall gets them off (the PLA-19 trap).
  it('keeps the session but offers a way out when the profile row is missing', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    mockFrom.mockReturnValue(
      profileQuery({
        data: null,
        error: { code: 'PGRST116', message: 'no rows', details: 'The result contains 0 rows' },
      })
    );

    await render(<RootLayout />);

    await screen.findByTestId('init-error');
    expect(mockSignOut).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('init-error-back'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' }));
    expect(mockForget).toHaveBeenCalled();
    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe('the auth listener', () => {
  it('ignores INITIAL_SESSION, which arrives as a bare null on a failed refresh', async () => {
    mockGetSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    mockFrom.mockReturnValue(profileQuery({ data: PROFILE, error: null }));

    await render(<RootLayout />);
    await screen.findByTestId('slot');

    // supabase-js swallows the refresh error and emits a null session, which
    // would sign the user out behind initialize()'s back.
    await act(async () => {
      emitAuthEvent('INITIAL_SESSION', null);
    });
    expect(useAuthStore.getState().session).toBe(SESSION);

    // A real sign-out still has to land.
    await act(async () => {
      emitAuthEvent('SIGNED_OUT', null);
    });
    expect(useAuthStore.getState().session).toBeNull();
  });
});
