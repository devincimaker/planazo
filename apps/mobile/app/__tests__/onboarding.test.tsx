import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import type { Profile } from '@planazo/shared';
import Index from '../index';
import OnboardingScreen from '../onboarding';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../lib/supabase';
import { stashPendingJoin, takePendingJoin } from '../../lib/pendingJoin';
import { stashPendingPlan, takePendingPlan } from '../../lib/pendingPlan';

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const update = jest.fn().mockResolvedValue({ error: null });

function profileWith(onboardedAt: string | null): Profile {
  return {
    id: 'user-1',
    email: 'nacho@example.com',
    display_name: 'Nacho Pardo',
    avatar_url: null,
    handle: 'nacho',
    push_token: null,
    push_enabled: true,
    add_to_calendar: false,
    onboarded_at: onboardedAt,
    created_at: '2026-08-06T00:00:00Z',
    updated_at: '2026-08-06T00:00:00Z',
  };
}

/** Only `session` truthiness matters to the gate, so a stub stands in for one. */
const SESSION = { user: { id: 'user-1' } } as never;

beforeEach(() => {
  jest.clearAllMocks();
  (supabase.from as jest.Mock).mockReturnValue({
    update: update.mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
  });
  useAuthStore.setState({ session: null, user: null, profile: null });
  // Module state, so drain whatever the last test left behind.
  takePendingJoin();
  takePendingPlan();
});

describe('the first-run gate', () => {
  // Index waits 100ms for the navigator; only these tests want to skip it.
  // `waitFor` polls on real timers, so faking them any wider hangs the suite.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends an account that has never seen the carousel to it', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith(null) });

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
  });

  it('sends a returning account straight to the app', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith('2026-08-01T10:00:00Z') });

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    expect(mockReplace).not.toHaveBeenCalledWith('/onboarding');
  });

  it('sends a signed-out visitor to login, carousel or not', async () => {
    useAuthStore.setState({ session: null, profile: null });

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(auth)/login');
  });

  it('does not interrupt someone whose profile has not loaded', async () => {
    // A row that failed to load is not evidence of a new account, and the
    // launch path has its own error state for that case.
    useAuthStore.setState({ session: SESSION, profile: null });

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
  });

  /**
   * PLA-77 arrives at the same junction. An invite link tapped without an
   * account sends the person to sign up, holding the code; this is where it
   * gets spent, rather than in login and signup, which would put the launch
   * decision in three places instead of one.
   */
  it('finishes a waiting invite instead of the tabs', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith('2026-08-01T10:00:00Z') });
    stashPendingJoin('ABCD2345');

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/join/ABCD2345');
  });

  /**
   * They tapped a particular group, and answering that is what they came to
   * do. The carousel is not lost: `onboarded_at` is still null, so the next
   * launch comes back through here and shows it.
   */
  it('lets a waiting invite outrank the carousel', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith(null) });
    stashPendingJoin('ABCD2345');

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/join/ABCD2345');
    expect(mockReplace).not.toHaveBeenCalledWith('/onboarding');
  });

  it('spends the code, so the next launch lands normally', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith('2026-08-01T10:00:00Z') });
    stashPendingJoin('ABCD2345');

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(takePendingJoin()).toBeNull();
  });

  it('leaves an ordinary launch alone when no invite is waiting', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith('2026-08-01T10:00:00Z') });

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
  });

  /**
   * The same journey for the other link Planazo hands out (PLA-81). A plan link
   * tapped with no session sends people here to sign in; landing them on the
   * feed would make the link a lie for the second time in one tap.
   */
  it('opens a waiting plan instead of the tabs, and outranks the carousel', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith(null) });
    stashPendingPlan('plan-1');

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/plan/plan-1');
    expect(mockReplace).not.toHaveBeenCalledWith('/onboarding');
  });

  it('spends the plan, so the next launch lands normally', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith('2026-08-01T10:00:00Z') });
    stashPendingPlan('plan-1');

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(takePendingPlan()).toBeNull();
  });

  /**
   * Both can only be waiting together if someone tapped an invite and a plan in
   * the same signed-out run. The invite wins because it is the one that grants
   * access, and it is usually the way into the very group the plan belongs to.
   * The plan is drained rather than kept, so it cannot surface a launch later
   * as a destination nobody asked for.
   */
  it('finishes the invite first when both are waiting, and keeps neither', async () => {
    useAuthStore.setState({ session: SESSION, profile: profileWith('2026-08-01T10:00:00Z') });
    stashPendingJoin('ABCD2345');
    stashPendingPlan('plan-1');

    await render(<Index />);
    jest.advanceTimersByTime(150);

    expect(mockReplace).toHaveBeenCalledWith('/(app)/join/ABCD2345');
    expect(mockReplace).not.toHaveBeenCalledWith('/(app)/plan/plan-1');
    expect(takePendingPlan()).toBeNull();
  });
});

describe('the carousel itself', () => {
  beforeEach(() => {
    useAuthStore.setState({ session: SESSION, profile: profileWith(null) });
  });

  it('carries all four cards', async () => {
    await render(<OnboardingScreen />);

    expect(screen.getByTestId('onboarding-people')).toBeTruthy();
    expect(screen.getByTestId('onboarding-plan')).toBeTruthy();
    expect(screen.getByTestId('onboarding-poll')).toBeTruthy();
    expect(screen.getByTestId('onboarding-album')).toBeTruthy();
  });

  it('offers exactly one way out, on the last card', async () => {
    await render(<OnboardingScreen />);

    expect(screen.getByTestId('onboarding-get-started')).toBeTruthy();
    expect(screen.queryByText('Skip')).toBeNull();
    expect(screen.queryByText('Next')).toBeNull();
  });

  it('records that it was seen, and lands on groups', async () => {
    await render(<OnboardingScreen />);

    await fireEvent.press(screen.getByTestId('onboarding-get-started'));

    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/groups');
    await waitFor(() => {
      expect(supabase.from).toHaveBeenCalledWith('profiles');
    });
    expect(useAuthStore.getState().profile?.onboarded_at).toEqual(expect.any(String));
  });

  it('stops the carousel coming back even when the write fails', async () => {
    (supabase.from as jest.Mock).mockReturnValue({
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: { message: 'offline' } }),
      }),
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await render(<OnboardingScreen />);
    await fireEvent.press(screen.getByTestId('onboarding-get-started'));

    // The store is what the gate reads on the way back, so this is what keeps
    // a flaky network from replaying onboarding at the next launch.
    await waitFor(() => {
      expect(useAuthStore.getState().profile?.onboarded_at).toEqual(expect.any(String));
    });
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/groups');
  });
});
