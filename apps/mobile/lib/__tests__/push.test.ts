import { registerPushToken, clearPushToken } from '../push';
import { supabase } from '../supabase';

// A getter, because `import * as Device` copies plain values at import time —
// the accessor keeps reads live so tests can flip _state.isDevice.
jest.mock('expo-device', () => {
  const _state = { isDevice: true };
  return {
    _state,
    get isDevice() {
      return _state.isDevice;
    },
  };
});

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const Device = jest.requireMock('expo-device');
const Notifications = jest.requireMock('expo-notifications');
const mockFrom = supabase.from as jest.Mock;
let profileUpdate: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  Device._state.isDevice = true;
  Notifications.getPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  Notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });

  mockFrom.mockImplementation(() => {
    const c: any = {};
    profileUpdate = c.update = jest.fn(() => c);
    c.eq = jest.fn(() => Promise.resolve({ error: null }));
    return c;
  });
});

describe('registerPushToken', () => {
  it('is a silent no-op on a simulator', async () => {
    Device._state.isDevice = false;

    await registerPushToken('sim-user');

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('writes nothing when permission is denied', async () => {
    Notifications.getPermissionsAsync.mockResolvedValue({ status: 'undetermined' });
    Notifications.requestPermissionsAsync.mockResolvedValue({ status: 'denied' });

    await registerPushToken('denied-user');

    expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('stores the token on the profile, once per app run', async () => {
    await registerPushToken('user-1');

    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(profileUpdate).toHaveBeenCalledWith({ push_token: 'ExponentPushToken[abc]' });

    // onAuthStateChange fires again on token refresh — no second write.
    await registerPushToken('user-1');
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

describe('clearPushToken', () => {
  it('wipes the stored token and lets a later sign-in register again', async () => {
    await registerPushToken('user-2');
    expect(mockFrom).toHaveBeenCalledTimes(1);

    await clearPushToken('user-2');
    expect(profileUpdate).toHaveBeenCalledWith({ push_token: null });

    await registerPushToken('user-2');
    expect(profileUpdate).toHaveBeenCalledWith({ push_token: 'ExponentPushToken[abc]' });
    expect(mockFrom).toHaveBeenCalledTimes(3);
  });
});
