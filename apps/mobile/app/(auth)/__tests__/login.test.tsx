import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import LoginScreen from '../login';
import { supabase } from '../../../lib/supabase';

const mockReplace = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { signInWithPassword: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

const mockSignIn = supabase.auth.signInWithPassword as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe('LoginScreen', () => {
  it('renders the email and password fields', async () => {
    await render(<LoginScreen />);

    expect(screen.getByPlaceholderText('your@email.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('Your password')).toBeTruthy();
    expect(screen.getByText('Sign In')).toBeTruthy();
  });

  it('rejects an empty submit without calling Supabase', async () => {
    await render(<LoginScreen />);

    await fireEvent.press(screen.getByText('Sign In'));

    expect(Alert.alert).toHaveBeenCalledWith('Error', 'Please fill in all fields');
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('shows the Supabase error and stays put on failed login', async () => {
    mockSignIn.mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    });

    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('your@email.com'), 'Test@Example.com ');
    await fireEvent.changeText(screen.getByPlaceholderText('Your password'), 'hunter22');
    await fireEvent.press(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', 'Invalid login credentials');
    });
    expect(mockSignIn).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'hunter22',
    });
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('loads the profile and navigates into the app on success', async () => {
    mockSignIn.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest
            .fn()
            .mockResolvedValue({ data: { id: 'user-1', display_name: 'Test' } }),
        }),
      }),
    });

    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('your@email.com'), 'test@example.com');
    await fireEvent.changeText(screen.getByPlaceholderText('Your password'), 'hunter22');
    await fireEvent.press(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    });
    expect(mockFrom).toHaveBeenCalledWith('profiles');
  });
});
