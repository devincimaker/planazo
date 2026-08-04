import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanPollCard } from '../PlanPollCard';
import { supabase } from '../../lib/supabase';

jest.mock('../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'upsert', 'delete', 'maybeSingle'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

const openPoll = {
  id: 'q1',
  question: 'Which film?',
  suggestions_open: false,
  closed_at: null,
  winner_option_id: null,
  closer: null,
  plan_poll_options: [
    { id: 'opt-dune', label: 'Dune Part Two', position: 0 },
    { id: 'opt-sub', label: 'The Substance', position: 1 },
    { id: 'opt-anora', label: 'Anora', position: 2 },
  ],
  plan_poll_votes: [
    { option_id: 'opt-dune', user_id: 'u1' },
    { option_id: 'opt-dune', user_id: 'u2' },
    { option_id: 'opt-anora', user_id: 'me' },
  ],
};

let votesChain: ReturnType<typeof chain>;
let pollsDeleteChain: ReturnType<typeof chain>;

function prime(poll: Record<string, unknown> | null) {
  votesChain = chain({ error: null });
  pollsDeleteChain = chain({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'plan_polls') {
      const c = chain({ data: poll, error: null });
      c.delete = pollsDeleteChain.delete;
      return c;
    }
    if (table === 'plan_poll_votes') return votesChain;
    return chain({ data: null, error: null });
  });
  mockRpc.mockResolvedValue({ data: { closed: true }, error: null });
}

const defaultProps = {
  planId: 'plan-1',
  userId: 'me',
  isHost: false,
  memberCount: 6,
  planEnded: false,
};

function renderCard(props: Partial<typeof defaultProps> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlanPollCard {...defaultProps} {...props} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PlanPollCard — open', () => {
  it('renders the question, every option with its count, and the voted line', async () => {
    prime(openPoll);
    renderCard();

    await waitFor(() => expect(screen.getByText('Which film?')).toBeTruthy());
    expect(screen.getByText('Still to decide')).toBeTruthy();
    expect(screen.getByTestId('poll-count-opt-dune')).toHaveTextContent('2');
    expect(screen.getByTestId('poll-count-opt-sub')).toHaveTextContent('0');
    expect(screen.getByTestId('poll-count-opt-anora')).toHaveTextContent('1');
    // "me" has voted, so no tap prompt — just the tally
    expect(screen.getByText('3 of 6 have voted')).toBeTruthy();
  });

  it('prompts someone who has not voted yet', async () => {
    prime({ ...openPoll, plan_poll_votes: [{ option_id: 'opt-dune', user_id: 'u1' }] });
    renderCard();
    await waitFor(() =>
      expect(screen.getByText('Tap the one you want · 1 of 6 have voted')).toBeTruthy()
    );
  });

  it('tapping an option casts a single-choice vote as an upsert on (poll, user)', async () => {
    prime(openPoll);
    renderCard();
    await waitFor(() => expect(screen.getByTestId('poll-option-opt-sub')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('poll-option-opt-sub'));

    await waitFor(() =>
      expect(votesChain.upsert).toHaveBeenCalledWith(
        { poll_id: 'q1', plan_id: 'plan-1', user_id: 'me', option_id: 'opt-sub' },
        { onConflict: 'poll_id,user_id' }
      )
    );
  });

  it('tapping your own option withdraws the vote', async () => {
    prime(openPoll);
    renderCard();
    await waitFor(() => expect(screen.getByTestId('poll-option-opt-anora')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('poll-option-opt-anora'));

    await waitFor(() => expect(votesChain.delete).toHaveBeenCalled());
    expect(votesChain.upsert).not.toHaveBeenCalled();
  });

  it('guests see no close button; the host closes on the single leader', async () => {
    prime(openPoll);
    renderCard();
    await waitFor(() => expect(screen.getByText('Which film?')).toBeTruthy());
    expect(screen.queryByTestId('poll-close')).toBeNull();

    prime(openPoll);
    renderCard({ isHost: true });
    await waitFor(() => expect(screen.getByTestId('poll-close')).toBeTruthy());
    expect(screen.getByText('Go with Dune Part Two')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poll-close'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('close_plan_poll', {
        p_plan_id: 'plan-1',
        p_option_id: undefined,
      })
    );
  });

  it('a tie asks the host to break it, from the leaders only', async () => {
    const sheetSpy = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation(() => {});
    prime({
      ...openPoll,
      plan_poll_votes: [
        { option_id: 'opt-dune', user_id: 'u1' },
        { option_id: 'opt-anora', user_id: 'u2' },
      ],
    });
    renderCard({ isHost: true });
    await waitFor(() => expect(screen.getByText('Break the tie')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('poll-close'));
    const call = sheetSpy.mock.calls.at(-1)!;
    expect(call[0].options).toEqual(['Dune Part Two', 'Anora', 'Cancel']);

    (call[1] as (i: number) => void)(1);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('close_plan_poll', {
        p_plan_id: 'plan-1',
        p_option_id: 'opt-anora',
      })
    );
  });

  it('with zero votes the host gets no close button at all', async () => {
    prime({ ...openPoll, plan_poll_votes: [] });
    renderCard({ isHost: true });
    await waitFor(() => expect(screen.getByText('Which film?')).toBeTruthy());
    expect(screen.queryByTestId('poll-close')).toBeNull();
    expect(screen.getByText('Tap the one you want. Nobody has voted yet')).toBeTruthy();
  });
});

describe('PlanPollCard — closed and ended', () => {
  const closedPoll = {
    ...openPoll,
    closed_at: '2026-08-04T12:00:00Z',
    winner_option_id: 'opt-dune',
    closer: { display_name: 'Marta' },
  };

  it('renders the answer: winner marked, closer named, no voting', async () => {
    prime(closedPoll);
    renderCard({ isHost: true });

    await waitFor(() => expect(screen.getByText('Decided')).toBeTruthy());
    expect(screen.getByText('Marta closed it')).toBeTruthy();
    expect(screen.queryByTestId('poll-close')).toBeNull();

    await fireEvent.press(screen.getByTestId('poll-option-opt-sub'));
    expect(votesChain.upsert).not.toHaveBeenCalled();
  });

  it('renders nothing when there is no poll', async () => {
    prime(null);
    renderCard();
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('plan_polls'));
    expect(screen.queryByTestId('plan-poll-card')).toBeNull();
  });

  it('an open question dies with its plan; a decided one stays', async () => {
    prime(openPoll);
    renderCard({ planEnded: true });
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith('plan_polls'));
    expect(screen.queryByTestId('plan-poll-card')).toBeNull();

    prime(closedPoll);
    renderCard({ planEnded: true });
    await waitFor(() => expect(screen.getByText('Decided')).toBeTruthy());
  });
});
