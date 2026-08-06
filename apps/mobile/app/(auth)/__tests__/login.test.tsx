import { StyleSheet } from 'react-native';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
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

  /**
   * The dead end PLA-70 closed. Signing up used to leave the account
   * unconfirmed and point people at this form, where Supabase's raw "Email not
   * confirmed" was the only thing that could ever happen.
   */
  it('sends an unconfirmed account to the code step instead of the raw error', async () => {
    mockSignIn.mockResolvedValue({
      data: {},
      error: { code: 'email_not_confirmed', message: 'Email not confirmed' },
    });

    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('your@email.com'), ' Nacho@Planazo.me ');
    await fireEvent.changeText(screen.getByPlaceholderText('Your password'), 'hunter22');
    await fireEvent.press(screen.getByTestId('sign-in'));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(auth)/signup',
        params: { verify: 'nacho@planazo.me' },
      });
    });
    expect(screen.queryByText('Email not confirmed')).toBeNull();
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
   * Layout guards. RNTL cannot lay anything out, so these assert the style and
   * structure decisions behind two bugs rather than the pixels: a `flex: 1`
   * body clamped to the ScrollView height, so overflowing content was clipped
   * instead of scrollable at Accessibility XXXL; a non-wrapping footer row that
   * ran off the side of the screen at those sizes; and the footer living inside
   * the scrolling content, where a raised keyboard pushed it below the fold and
   * first-timers never found the way to sign up (PLA-69).
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
    const row = StyleSheet.flatten(screen.getByTestId('login-footer-row').props.style);

    expect(row.flexWrap).toBe('wrap');
  });

  it('keeps both ways out of the screen clear of the keyboard', async () => {
    await render(<LoginScreen />);

    // Anything inside the ScrollView can be pushed below the fold once the
    // keyboard shrinks the viewport. Sign in and the signup link must not be.
    const scroll = within(screen.getByTestId('login-scroll'));
    expect(scroll.queryByTestId('login-footer')).toBeNull();
    expect(scroll.queryByTestId('sign-in')).toBeNull();
    expect(scroll.queryByTestId('signup-link')).toBeNull();

    const footer = within(screen.getByTestId('login-footer'));
    expect(footer.getByTestId('sign-in')).toBeTruthy();
    expect(footer.getByTestId('signup-link')).toBeTruthy();
  });

  it('masks the password until the reveal toggle is pressed', async () => {
    await render(<LoginScreen />);

    expect(screen.getByPlaceholderText('Your password').props.secureTextEntry).toBe(true);

    await fireEvent.press(screen.getByTestId('password-input-reveal'));

    expect(screen.getByPlaceholderText('Your password').props.secureTextEntry).toBe(false);
  });
});
