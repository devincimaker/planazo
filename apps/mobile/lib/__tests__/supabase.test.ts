/**
 * `signOut({ scope: 'local' })` still calls /logout, and supabase-js returns
 * early without clearing storage when that call fails. These cover the copy we
 * keep ourselves so a sign-out cannot silently un-happen at the next launch.
 */
const mockSecureStore = {
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
};
jest.mock('expo-secure-store', () => mockSecureStore);
jest.mock('react-native-url-polyfill/auto', () => ({}));

const mockCaptured: { storage?: any } = {};
jest.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: any) => {
    mockCaptured.storage = options.auth.storage;
    return { auth: {}, from: jest.fn() };
  },
}));

process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { forgetStoredSession } = require('../supabase');
const storage = () => mockCaptured.storage;

/** What supabase-js actually stores under, derived from the URL. */
const AUTH_KEY = 'sb-127-auth-token';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('forgetStoredSession', () => {
  // The launch case: the SDK only ever *read* the session this run, so tracking
  // writes alone would leave the credentials on disk.
  it('clears a key it has only ever read', async () => {
    await storage().getItem(AUTH_KEY);

    await forgetStoredSession();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_KEY);
  });

  it('clears a key it has written', async () => {
    storage().setItem(AUTH_KEY, 'a-session');

    await forgetStoredSession();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_KEY);
  });

  it('clears every key the SDK has touched, not just the session', async () => {
    await storage().getItem(AUTH_KEY);
    storage().setItem(`${AUTH_KEY}-code-verifier`, 'verifier');

    await forgetStoredSession();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(AUTH_KEY);
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith(`${AUTH_KEY}-code-verifier`);
  });

  it('does not ask twice for a key the SDK already removed', async () => {
    await storage().getItem(AUTH_KEY);
    storage().removeItem(AUTH_KEY);
    mockSecureStore.deleteItemAsync.mockClear();

    await forgetStoredSession();

    expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  // One key failing to delete must not leave the rest behind — that would be
  // the same half-signed-out state this exists to prevent.
  it('keeps going when one delete fails', async () => {
    await storage().getItem(AUTH_KEY);
    storage().setItem(`${AUTH_KEY}-code-verifier`, 'verifier');
    mockSecureStore.deleteItemAsync.mockRejectedValueOnce(new Error('keychain locked'));

    await expect(forgetStoredSession()).resolves.toBeUndefined();

    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledTimes(2);
  });
});
