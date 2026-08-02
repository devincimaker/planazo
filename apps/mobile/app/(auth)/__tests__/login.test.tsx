import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
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
});

describe('LoginScreen', () => {
  it('renders the email and password fields', async () => {
    await render(<LoginScreen />);

    expect(screen.getByPlaceholderText('your@email.com')).toBeTruthy();
    expect(screen.getByPlaceholderText('Your password')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
  });

  it('rejects an empty submit without calling Supabase', async () => {
    await render(<LoginScreen />);

    await fireEvent.press(screen.getByTestId('sign-in'));

    expect(screen.getByTestId('login-error')).toBeTruthy();
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
    await fireEvent.press(screen.getByTestId('sign-in'));

    await waitFor(() => {
      expect(screen.getByText('Invalid login credentials')).toBeTruthy();
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
    await fireEvent.press(screen.getByTestId('sign-in'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    });
    expect(mockFrom).toHaveBeenCalledWith('profiles');
  });

  /**
   * Dynamic Type guards. RNTL cannot lay anything out, so these assert the two
   * style decisions that broke at Accessibility XXXL rather than the pixels:
   * a `flex: 1` body clamped to the ScrollView height, so overflowing content
   * was clipped instead of scrollable and the sign-in button sat below the
   * fold; and a non-wrapping footer row ran off the side of the screen.
   */
  it('lets the form grow past the viewport rather than clamping it', async () => {
    await render(<LoginScreen />);

    const scroll = screen.getByTestId('login-scroll');
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).flexGrow).toBe(1);

    const body = StyleSheet.flatten(screen.getByTestId('login-body').props.style);
    expect(body.flexGrow).toBe(1);
    expect(body.flex).toBeUndefined();
  });

  it('wraps the footer instead of running it off the screen', async () => {
    await render(<LoginScreen />);
    const footer = StyleSheet.flatten(screen.getByTestId('login-footer').props.style);

    expect(footer.flexWrap).toBe('wrap');
    // Pins the footer to the bottom when there is room, yields when there is not.
    expect(footer.marginTop).toBe('auto');
  });

  it('masks the password until the reveal toggle is pressed', async () => {
    await render(<LoginScreen />);

    expect(screen.getByPlaceholderText('Your password').props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByTestId('password-input-reveal'));

    expect(screen.getByPlaceholderText('Your password').props.secureTextEntry).toBe(false);
  });
});
