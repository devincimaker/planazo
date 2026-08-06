import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import SignupScreen from '../signup';
import { supabase } from '../../../lib/supabase';

const mockReplace = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { signUp: jest.fn(), verifyOtp: jest.fn(), resend: jest.fn() },
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('base64-arraybuffer', () => ({ decode: jest.fn() }));

const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockVerifyOtp = supabase.auth.verifyOtp as jest.Mock;
const mockResend = supabase.auth.resend as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

const profileReturning = (profile: object) => ({
  select: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: profile }),
    }),
  }),
  update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
});

const fill = async (name: string, email: string, password: string) => {
  await fireEvent.changeText(screen.getByTestId('name-input'), name);
  await fireEvent.changeText(screen.getByTestId('email-input'), email);
  await fireEvent.changeText(screen.getByTestId('password-input'), password);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockResend.mockResolvedValue({ error: null });
});

describe('SignupScreen', () => {
  it('names the next missing field on the footer button instead of going mute', async () => {
    await render(<SignupScreen />);

    expect(screen.getByText('Add your name to continue')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('name-input'), 'Nacho');
    expect(screen.getByText('Add your email to continue')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('email-input'), 'nacho@planazo.me');
    expect(screen.getByText('Pick a password to continue')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('password-input'), 'short');
    expect(screen.getByText('Make it 6 characters or more')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('password-input'), 'hunter22');
    expect(screen.getByText('Make my account')).toBeTruthy();
  });

  it('does not call Supabase while the form is incomplete', async () => {
    await render(<SignupScreen />);

    await fireEvent.press(screen.getByTestId('create-account'));

    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('shows the Supabase error inline and stays put', async () => {
    mockSignUp.mockResolvedValue({
      data: {},
      error: { message: 'User already registered' },
    });

    await render(<SignupScreen />);
    await fill('Nacho', ' Nacho@Planazo.me ', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => {
      expect(screen.getByText('User already registered')).toBeTruthy();
    });
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'nacho@planazo.me',
      password: 'hunter22',
      options: { data: { display_name: 'Nacho' } },
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('goes into the app when signup returns a session', async () => {
    mockSignUp.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    mockFrom.mockReturnValue(profileReturning({ id: 'user-1', display_name: 'Nacho' }));

    await render(<SignupScreen />);
    await fill('Nacho', 'nacho@planazo.me', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    });
  });

  /**
   * The old flow ended here on a card whose only button led to the sign-in
   * form, where the only possible outcome was "Email not confirmed" (PLA-70).
   * The code step replaces it in place, on this same screen.
   */
  it('asks for the code on this screen when confirmation is required', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });

    await render(<SignupScreen />);
    await fill('Nacho', ' Nacho@Planazo.me ', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => {
      expect(screen.getByTestId('code-input')).toBeTruthy();
    });
    expect(screen.getByText(/nacho@planazo\.me/)).toBeTruthy();
    expect(screen.queryByTestId('go-to-login')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    // Nothing goes out unasked on this path: signUp already sent the code.
    expect(mockResend).not.toHaveBeenCalled();
  });

  /**
   * The photo used to be lost here. It lives in this component's state and the
   * upload needs a session, so replacing the screen with a card threw it away.
   */
  it('uploads the photo picked before confirmation, once the code lands', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });
    mockVerifyOtp.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    const profiles = profileReturning({ id: 'user-1', display_name: 'Nacho' });
    mockFrom.mockReturnValue(profiles);
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///photo.jpg' }],
    });
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue('base64data');
    const upload = jest.fn().mockResolvedValue({ error: null });
    (supabase.storage.from as jest.Mock).mockReturnValue({
      upload,
      getPublicUrl: () => ({ data: { publicUrl: 'https://cdn/avatar.jpg' } }),
    });

    await render(<SignupScreen />);
    await fireEvent.press(screen.getByTestId('add-photo'));
    await fill('Nacho', 'nacho@planazo.me', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => expect(screen.getByTestId('code-input')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('code-input'), '604928');
    await fireEvent.press(screen.getByTestId('confirm-code'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    });
    expect(upload).toHaveBeenCalledWith('user-1/avatar.jpg', undefined, {
      upsert: true,
      contentType: 'image/jpeg',
    });
    expect(profiles.update).toHaveBeenCalledWith({ avatar_url: 'https://cdn/avatar.jpg' });
  });

  it('opens straight into the code step when sign-in hands an address over', async () => {
    mockParams = { verify: 'nacho@planazo.me' };

    await render(<SignupScreen />);

    expect(screen.getByTestId('code-input')).toBeTruthy();
    // Their old code is stale or lost by the time they get here, so one goes
    // out without them having to ask for it.
    await waitFor(() => {
      expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'nacho@planazo.me' });
    });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it('goes back to the form with the address still filled in', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });

    await render(<SignupScreen />);
    await fill('Nacho', 'nacho@planazo.me', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => expect(screen.getByTestId('code-input')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('confirm-back'));

    expect(screen.getByTestId('email-input').props.value).toBe('nacho@planazo.me');
  });
});
