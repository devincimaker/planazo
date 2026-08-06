import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ConfirmEmailStep } from '../ConfirmEmailStep';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: { verifyOtp: jest.fn(), resend: jest.fn() },
  },
}));

const mockVerifyOtp = supabase.auth.verifyOtp as jest.Mock;
const mockResend = supabase.auth.resend as jest.Mock;

const onVerified = jest.fn();
const onBack = jest.fn();

const renderStep = (autoSend = false) =>
  render(
    <ConfirmEmailStep
      email="nacho@planazo.me"
      autoSend={autoSend}
      onVerified={onVerified}
      onBack={onBack}
    />,
  );

const enter = async (code: string) => {
  await fireEvent.changeText(screen.getByTestId('code-input'), code);
};

/**
 * Run the cooldown down a second at a time.
 *
 * One `advanceTimersByTime(30_000)` does not do it: the countdown schedules its
 * next tick from an effect, so React has to commit each second before the
 * timeout for the following one exists. Jumping the whole window fires exactly
 * one tick and leaves 29 on the clock.
 */
const runCooldown = async () => {
  for (let second = 0; second < 30; second += 1) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResend.mockResolvedValue({ error: null });
});

describe('ConfirmEmailStep', () => {
  it('names what is missing on the footer button rather than going mute', async () => {
    await renderStep();

    expect(screen.getByText('Enter the 6 digits to continue')).toBeTruthy();

    await enter('6049');
    expect(screen.getByText('Enter the 6 digits to continue')).toBeTruthy();

    await enter('604928');
    expect(screen.getByText('Confirm and continue')).toBeTruthy();
  });

  it('keeps only the digits, however they arrive', async () => {
    await renderStep();

    // A code pasted out of a mail client brings its whitespace with it, and
    // refusing that paste would be the app's fault, not the user's.
    await enter(' 604 928 ');

    expect(screen.getByTestId('code-input').props.value).toBe('604928');
  });

  it('does not call Supabase with a half-typed code', async () => {
    await renderStep();

    await enter('6049');
    await fireEvent.press(screen.getByTestId('confirm-code'));

    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it('hands the session up when the code is right', async () => {
    const session = { user: { id: 'user-1' } };
    mockVerifyOtp.mockResolvedValue({ data: { session }, error: null });

    await renderStep();
    await enter('604928');
    await fireEvent.press(screen.getByTestId('confirm-code'));

    await waitFor(() => {
      expect(onVerified).toHaveBeenCalledWith(session);
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: 'nacho@planazo.me',
      token: '604928',
      type: 'signup',
    });
  });

  /**
   * GoTrue answers a wrong code and an expired one with the same
   * `otp_expired`, so there is nothing to tell them apart with. One message
   * covers both, and points at the *last* email because asking for a new code
   * silently kills every code before it.
   */
  it('says the same honest thing for a wrong code as for an expired one', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: 'otp_expired', message: 'Token has expired or is invalid' },
    });

    await renderStep();
    await enter('000000');
    await fireEvent.press(screen.getByTestId('confirm-code'));

    await waitFor(() => {
      expect(
        screen.getByText("That code didn't work. Check the last email we sent, or ask for a new one."),
      ).toBeTruthy();
    });
    expect(screen.queryByText('Token has expired or is invalid')).toBeNull();
    expect(onVerified).not.toHaveBeenCalled();
  });

  /**
   * A code went out with the signup that got us here, so the link starts
   * cooled down: Supabase refuses a second email inside its max_frequency
   * window, and a button whose first press is always rejected looks broken.
   */
  it('holds the resend link back until the cooldown runs out', async () => {
    jest.useFakeTimers();
    try {
      await renderStep();

      expect(screen.getByText('You can ask again in 30s')).toBeTruthy();
      await fireEvent.press(screen.getByTestId('resend-code'));
      expect(mockResend).not.toHaveBeenCalled();

      await runCooldown();

      expect(screen.getByText('Send a new code')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('warns that the newest code is the only one that works', async () => {
    jest.useFakeTimers();
    try {
      await renderStep();
      await runCooldown();

      await enter('604928');
      await fireEvent.press(screen.getByTestId('resend-code'));

      await waitFor(() => {
        expect(screen.getByText('New code sent. Use the one in the newest email.')).toBeTruthy();
      });
      expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'nacho@planazo.me' });
      // The code they typed belongs to the email we just superseded.
      expect(screen.getByTestId('code-input').props.value).toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('survives a refused resend instead of dumping the 429 on screen', async () => {
    jest.useFakeTimers();
    try {
      mockResend.mockResolvedValue({
        error: {
          code: 'over_email_send_rate_limit',
          message: 'For security purposes, you can only request this after 46 seconds.',
        },
      });

      await renderStep();
      await runCooldown();
      await fireEvent.press(screen.getByTestId('resend-code'));

      await waitFor(() => {
        expect(screen.getByText('Give it a few seconds, then ask again.')).toBeTruthy();
      });
      expect(screen.queryByText(/For security purposes/)).toBeNull();
      // Refused means refused: the link goes quiet again rather than inviting
      // another press that would be refused the same way.
      expect(screen.getByText('You can ask again in 30s')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sends a fresh code on arrival when sign-in handed the address over', async () => {
    await renderStep(true);

    await waitFor(() => {
      expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'nacho@planazo.me' });
    });
    expect(screen.getByText('We sent you a fresh code. Use the one in the newest email.')).toBeTruthy();
  });

  it('does not send anything on arrival from signup', async () => {
    await renderStep(false);

    expect(mockResend).not.toHaveBeenCalled();
  });

  it('offers a way back to the form', async () => {
    await renderStep();

    await fireEvent.press(screen.getByTestId('confirm-back'));

    expect(onBack).toHaveBeenCalled();
  });
});
