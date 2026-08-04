import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanPolls } from '../PlanPolls';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const mockFrom = supabase.from as jest.Mock;

function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'order', 'upsert', 'delete'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

const filmPoll = {
  id: 'q-film',
  question: 'Which film',
  suggestions_open: false,
  created_at: '2026-08-04T10:00:00Z',
  plan_poll_options: [
    { id: 'opt-whiplash', label: 'Whiplash', position: 0 },
    { id: 'opt-perfect', label: 'Perfect Days', position: 1 },
    { id: 'opt-aftersun', label: 'Aftersun', position: 2 },
  ],
  plan_poll_votes: [
    { option_id: 'opt-whiplash', user_id: 'u-caro', profile: { display_name: 'Caro' } },
    { option_id: 'opt-whiplash', user_id: 'u-sofi', profile: { display_name: 'Sofi' } },
    { option_id: 'opt-aftersun', user_id: 'me', profile: { display_name: 'Vale' } },
  ],
};

const foodPoll = {
  id: 'q-food',
  question: 'Who brings what',
  suggestions_open: false,
  created_at: '2026-08-04T11:00:00Z',
  plan_poll_options: [
    { id: 'opt-asado', label: 'Asado', position: 0 },
    { id: 'opt-pizza', label: 'Pizza y vino', position: 1 },
  ],
  plan_poll_votes: [
    { option_id: 'opt-asado', user_id: 'u-pau', profile: { display_name: 'Pau' } },
  ],
};

let votesChain: ReturnType<typeof chain>;

function prime(polls: Record<string, unknown>[]) {
  votesChain = chain({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'plan_polls') return chain({ data: polls, error: null });
    if (table === 'plan_poll_votes') return votesChain;
    return chain({ data: null, error: null });
  });
}

const defaultProps = {
  planId: 'plan-1',
  userId: 'me',
  isHost: false,
  peopleIn: 5,
  canVote: true,
  planEnded: false,
};

function renderPolls(props: Partial<typeof defaultProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlanPolls {...defaultProps} {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PlanPolls — the running tally', () => {
  it('renders every option with count, the Leading badge, and the voted caption', async () => {
    prime([filmPoll]);
    renderPolls();

    await waitFor(() => expect(screen.getByText('Which film')).toBeTruthy());
    expect(screen.getByText('3 of 5 voted')).toBeTruthy();
    expect(screen.getByTestId('poll-count-opt-whiplash')).toHaveTextContent('2 votes');
    expect(screen.getByTestId('poll-count-opt-perfect')).toHaveTextContent('0 votes');
    expect(screen.getByTestId('poll-count-opt-aftersun')).toHaveTextContent('1 vote');
    expect(screen.getByText('Leading')).toBeTruthy();
  });

  it('tapping an option moves your vote; tapping your own withdraws it', async () => {
    prime([filmPoll]);
    renderPolls();
    await waitFor(() => expect(screen.getByTestId('poll-option-opt-perfect')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('poll-option-opt-perfect'));
    await waitFor(() =>
      expect(votesChain.upsert).toHaveBeenCalledWith(
        { poll_id: 'q-film', plan_id: 'plan-1', user_id: 'me', option_id: 'opt-perfect' },
        { onConflict: 'poll_id,user_id' }
      )
    );

    await fireEvent.press(screen.getByTestId('poll-option-opt-aftersun'));
    await waitFor(() => expect(votesChain.delete).toHaveBeenCalled());
  });

  it('several polls: the first opens, the rest fold to lead and standing', async () => {
    prime([filmPoll, foodPoll]);
    renderPolls();

    await waitFor(() => expect(screen.getByText('Who brings what')).toBeTruthy());
    // The film poll is expanded (its option rows are on screen)...
    expect(screen.getByTestId('poll-option-opt-whiplash')).toBeTruthy();
    // ...the food poll is folded to its lead row.
    expect(screen.queryByTestId('poll-option-opt-asado')).toBeNull();
    expect(screen.getByTestId('poll-lead-q-food')).toHaveTextContent(/Asado/);
    expect(screen.getByTestId('poll-lead-q-food')).toHaveTextContent(/You haven't voted/);

    // Unfolding brings the rows out.
    await fireEvent.press(screen.getByTestId('poll-toggle-q-food'));
    await waitFor(() => expect(screen.getByTestId('poll-option-opt-asado')).toBeTruthy());
  });

  it('nobody voted: empty bars, a first-vote nudge, Nothing yet when folded', async () => {
    prime([{ ...filmPoll, plan_poll_votes: [] }, foodPoll]);
    renderPolls();

    await waitFor(() => expect(screen.getByText("Nobody's voted")).toBeTruthy());
    expect(screen.getByText('Be the first. One pick each, changeable any time.')).toBeTruthy();
  });
});

describe('PlanPolls — who gets a pick', () => {
  it('not in yet: rows are inert, no faces, and the caption says why', async () => {
    prime([filmPoll]);
    renderPolls({ canVote: false });

    await waitFor(() => expect(screen.getByTestId('poll-option-opt-whiplash')).toBeTruthy());
    expect(screen.getByText("Say you're in and you get a pick.")).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poll-option-opt-whiplash'));
    expect(votesChain.upsert).not.toHaveBeenCalled();
  });

  it('a refused vote says what is true, not "you are not in the group"', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    prime([filmPoll]);
    // The stale-gate race: the UI thinks you can vote, RLS knows you cannot.
    votesChain.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ error: { code: '42501', message: 'permission denied' } }).then(resolve);
    renderPolls();
    await waitFor(() => expect(screen.getByTestId('poll-option-opt-perfect')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('poll-option-opt-perfect'));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Say you're in first",
        'Voting is for people who are in this plan. Answer yes and you get a pick.'
      )
    );
    alertSpy.mockRestore();
  });

  it('an ended plan keeps the tally but takes no votes and no new polls', async () => {
    prime([filmPoll]);
    renderPolls({ planEnded: true, isHost: true });

    await waitFor(() => expect(screen.getByTestId('poll-option-opt-whiplash')).toBeTruthy());
    expect(screen.queryByTestId('poll-add')).toBeNull();

    await fireEvent.press(screen.getByTestId('poll-option-opt-whiplash'));
    expect(votesChain.upsert).not.toHaveBeenCalled();
  });
});

describe('PlanPolls — the host invitation', () => {
  it('no polls: hosts get the dashed invitation, guests get nothing at all', async () => {
    prime([]);
    renderPolls({ isHost: true });
    await waitFor(() => expect(screen.getByTestId('poll-add')).toBeTruthy());
    expect(screen.getByText('+ Add a poll')).toBeTruthy();
    expect(screen.getByText('Let them pick the film, the place, who brings what')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poll-add'));
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1/poll');
  });

  it('with polls the invitation reads add another', async () => {
    prime([filmPoll]);
    renderPolls({ isHost: true });
    await waitFor(() => expect(screen.getByTestId('poll-add')).toBeTruthy());
    expect(screen.getByText('+ Add another poll')).toBeTruthy();
    expect(screen.getByText('Only you can add one')).toBeTruthy();
  });
});
