import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import ForgotPasswordScreen from '../forgot';
import { supabase } from '../../../lib/supabase';

const mockReplace = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { resetPasswordForEmail: jest.fn() },
  },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `planazo://${path.replace(/^\//, '')}`,
}));

const mockReset = supabase.auth.resetPasswordForEmail as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ForgotPasswordScreen', () => {
  it('will not send without an email', async () => {
    await render(<ForgotPasswordScreen />);

    await fireEvent.press(screen.getByTestId('send-link'));

    expect(screen.getByTestId('forgot-error')).toBeTruthy();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('sends the recovery link to the deep link the app can open', async () => {
    mockReset.mockResolvedValue({ error: null });

    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('email-input'), ' Nacho@Planazo.me ');
    await fireEvent.press(screen.getByTestId('send-link'));

    await waitFor(() => {
      expect(screen.getByTestId('link-sent')).toBeTruthy();
    });
    expect(mockReset).toHaveBeenCalledWith('nacho@planazo.me', {
      redirectTo: 'planazo://reset-password',
    });
    expect(screen.getByText(/nacho@planazo\.me/)).toBeTruthy();
  });

  it('resends to the same address without asking for it again', async () => {
    mockReset.mockResolvedValue({ error: null });

    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('email-input'), 'nacho@planazo.me');
    await fireEvent.press(screen.getByTestId('send-link'));

    await waitFor(() => expect(screen.getByTestId('resend')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('resend'));

    await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(2));
    expect(mockReset).toHaveBeenLastCalledWith('nacho@planazo.me', {
      redirectTo: 'planazo://reset-password',
    });
  });

  it('surfaces a Supabase failure instead of claiming the mail went out', async () => {
    mockReset.mockResolvedValue({ error: { message: 'Email rate limit exceeded' } });

    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('email-input'), 'nacho@planazo.me');
    await fireEvent.press(screen.getByTestId('send-link'));

    await waitFor(() => {
      expect(screen.getByText('Email rate limit exceeded')).toBeTruthy();
    });
    expect(screen.queryByTestId('link-sent')).toBeNull();
  });
});
