import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import SignupScreen from '../signup';
import { supabase } from '../../../lib/supabase';

const mockReplace = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { signUp: jest.fn() },
    from: jest.fn(),
    storage: { from: jest.fn() },
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('base64-arraybuffer', () => ({ decode: jest.fn() }));

const mockSignUp = supabase.auth.signUp as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

const fill = async (name: string, email: string, password: string) => {
  await fireEvent.changeText(screen.getByTestId('name-input'), name);
  await fireEvent.changeText(screen.getByTestId('email-input'), email);
  await fireEvent.changeText(screen.getByTestId('password-input'), password);
};

beforeEach(() => {
  jest.clearAllMocks();
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
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: { id: 'user-1', display_name: 'Nacho' } }),
        }),
      }),
    });

    await render(<SignupScreen />);
    await fill('Nacho', 'nacho@planazo.me', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    });
  });

  it('sends the user to their inbox when confirmation is required', async () => {
    mockSignUp.mockResolvedValue({ data: { session: null }, error: null });

    await render(<SignupScreen />);
    await fill('Nacho', 'nacho@planazo.me', 'hunter22');
    await fireEvent.press(screen.getByTestId('create-account'));

    await waitFor(() => {
      expect(screen.getByTestId('check-inbox')).toBeTruthy();
    });
    expect(screen.getByText(/nacho@planazo\.me/)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
