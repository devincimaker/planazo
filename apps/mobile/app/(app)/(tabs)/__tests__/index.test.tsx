import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FeedScreen from '../index';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();
const mockNavigate = jest.fn();

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    replace: jest.fn(),
    back: jest.fn(),
  }),
}));


const mockFrom = supabase.from as jest.Mock;

/** Chainable, awaitable Supabase query-builder stub. */
function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'in', 'neq', 'gte', 'order', 'limit', 'upsert', 'update', 'delete'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

/** ISO timestamp N days from today at the given hour, local time. */
function iso(daysFromNow: number, hour = 19) {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + daysFromNow,
    hour,
    0,
    0
  ).toISOString();
}

const GROUP = { id: 'g1', name: 'Domingueros' };

const fixedOpen = {
  id: 'p1',
  title: 'Padel + pizza',
  plan_type: 'fixed',
  status: 'open',
  min_people: 3,
  // Relative, like every other date here: the feed drops past plans, so a
  // literal date turns this fixture invisible the morning after it passes and
  // takes eleven tests with it.
  event_date: iso(2),
  location: 'Padel Indoor Gràcia',
  groups: GROUP,
  rsvps: [
    { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
    { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
  ],
  plan_date_options: [],
};

const fixedAnswered = {
  ...fixedOpen,
  id: 'p2',
  title: 'Sunday roast',
  rsvps: [
    { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
    { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
    { user_id: 'u-clara', response: 'yes', profile: { display_name: 'Clara' } },
  ],
};

const flexibleOpen = {
  id: 'p3',
  title: 'Escape room revenge',
  plan_type: 'flexible',
  status: 'open',
  min_people: 2,
  event_date: null,
  locked_date: null,
  description: 'Last time was humiliating',
  groups: { id: 'g2', name: 'Escapistas' },
  rsvps: [],
  plan_date_options: [
    { id: 'd1', date: '2026-08-13', date_availability: [{ user_id: 'u-aina', profile: { display_name: 'Aina' } }] },
    { id: 'd2', date: '2026-08-14', date_availability: [] },
  ],
};

// Locking seeds everyone who was free on the chosen date into a 'yes' they
// never tapped — so this card, of all of them, has to keep a way out (PLA-16).
const lockedFlexible = {
  id: 'p4',
  title: 'Escape room revenge',
  plan_type: 'flexible',
  status: 'locked',
  min_people: 2,
  event_date: null,
  locked_date: iso(9),
  groups: { id: 'g2', name: 'Escapistas' },
  rsvps: [
    { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
    { user_id: 'u-aina', response: 'yes', profile: { display_name: 'Aina' } },
  ],
  plan_date_options: [
    {
      id: 'd1',
      date: iso(9),
      date_availability: [
        { user_id: 'me', profile: { display_name: 'Me' } },
        { user_id: 'u-aina', profile: { display_name: 'Aina' } },
        { user_id: 'u-pau', profile: { display_name: 'Pau' } },
      ],
    },
  ],
};

let plansChain: ReturnType<typeof chain>;
let pollVotesChain: ReturnType<typeof chain>;
let rsvpsChain: ReturnType<typeof chain>;
let availChain: ReturnType<typeof chain>;

let noticesChain: ReturnType<typeof chain>;

/** One group, in the shape both readers of group_members expect. */
const IN_A_GROUP = [{ group_id: 'g1', groups: { id: 'g1', name: 'Domingueros', color: null } }];

function primeSupabase(
  plans: unknown[],
  {
    notices = [],
    cancelledPlans = [],
    memberships = IN_A_GROUP,
  }: { notices?: unknown[]; cancelledPlans?: unknown[]; memberships?: unknown[] } = {}
) {
  plansChain = chain({ data: plans, error: null });
  pollVotesChain = chain({ error: null });
  // Deletes ask for the cleared rows back (PLA-16), so the stub has to hand
  // one over or every withdrawal reads as the silent no-op it used to be.
  rsvpsChain = chain({ data: [{ plan_id: 'p' }], error: null });
  availChain = chain({ error: null });
  noticesChain = chain({ data: notices, error: null });
  mockFrom.mockImplementation((table: string) => {
    // Two queries read this table with different shapes: the feed wants
    // group_id to filter plans, useMyGroups wants the joined row to decide
    // which empty state you get (PLA-68). One stub row satisfies both.
    if (table === 'group_members') {
      return chain({ data: memberships, error: null });
    }
    if (table === 'plans') {
      // The home query filters cancelled via .neq; the 19e notice fetch
      // doesn't — that call gets the cancelled rows.
      const c = chain({ data: cancelledPlans, error: null });
      c.neq = jest.fn(() => plansChain);
      return c;
    }
    if (table === 'notifications') return noticesChain;
    if (table === 'rsvps') return rsvpsChain;
    if (table === 'plan_poll_votes') return pollVotesChain;
    if (table === 'date_availability') return availChain;
    return chain({ data: null, error: null });
  });
}

function renderFeed() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <FeedScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
});

describe('FeedScreen', () => {
  it('renders plan cards with title, badge and group', async () => {
    primeSupabase([fixedOpen, flexibleOpen]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Padel + pizza')).toBeTruthy());
    expect(screen.getByText('Escape room revenge')).toBeTruthy();
    expect(screen.getByText('Domingueros')).toBeTruthy();
    expect(screen.getByText('2 dates on the table')).toBeTruthy();
    expect(screen.getAllByText('Unanswered').length).toBeGreaterThan(0);
  });

  it('PLA-47: someone in the plan votes on the card, one pick, changeable', async () => {
    const poll = {
      id: 'q1',
      question: 'Which film',
      created_at: '2026-08-04T10:00:00Z',
      plan_poll_options: [
        { id: 'opt-dune', label: 'Dune Part Two', position: 0 },
        { id: 'opt-anora', label: 'Anora', position: 1 },
      ],
      plan_poll_votes: [
        { option_id: 'opt-dune', user_id: 'u-marta' },
        { option_id: 'opt-anora', user_id: 'me' },
      ],
    };
    // fixedAnswered has my yes, so the poll is live for me.
    primeSupabase([{ ...fixedAnswered, plan_polls: [poll] }]);
    await renderFeed();

    await waitFor(() => expect(screen.getByTestId('poll-feed-p2')).toBeTruthy());
    expect(screen.getByText('Which film')).toBeTruthy();
    expect(screen.getByText('You picked Anora · tap to change')).toBeTruthy();
    expect(screen.getAllByText('1 vote')).toHaveLength(2);

    // Another option moves the vote...
    await fireEvent.press(screen.getByTestId('poll-feed-option-opt-dune'));
    await waitFor(() =>
      expect(pollVotesChain.upsert).toHaveBeenCalledWith(
        { poll_id: 'q1', plan_id: 'p2', user_id: 'me', option_id: 'opt-dune' },
        { onConflict: 'poll_id,user_id' }
      )
    );

    // ...your own withdraws it.
    await fireEvent.press(screen.getByTestId('poll-feed-option-opt-anora'));
    await waitFor(() => expect(pollVotesChain.delete).toHaveBeenCalled());
  });

  it("PLA-47: a bystander sees the tally but the rows don't take a tap", async () => {
    const poll = {
      id: 'q1',
      question: 'Which film',
      created_at: '2026-08-04T10:00:00Z',
      plan_poll_options: [{ id: 'opt-dune', label: 'Dune Part Two', position: 0 }],
      plan_poll_votes: [{ option_id: 'opt-dune', user_id: 'u-marta' }],
    };
    // fixedOpen carries no rsvp of mine, so no pick.
    primeSupabase([{ ...fixedOpen, plan_polls: [poll] }]);
    await renderFeed();

    await waitFor(() => expect(screen.getByTestId('poll-feed-p1')).toBeTruthy());
    expect(screen.getByText('1 of 2 voted')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poll-feed-option-opt-dune'));
    expect(pollVotesChain.upsert).not.toHaveBeenCalled();
    expect(pollVotesChain.delete).not.toHaveBeenCalled();
  });

  it('picks dates inline and sends them (2a)', async () => {
    primeSupabase([flexibleOpen]);
    await renderFeed();
    await waitFor(() => expect(screen.getByText('Tap the dates you can do')).toBeTruthy());
    expect(screen.getByText('1 free')).toBeTruthy();
    expect(screen.getByText('0 free')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('date-option-d1'));
    expect(screen.getByText('Send 1 date')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('date-option-d2'));
    await fireEvent.press(screen.getByText('Send 2 dates'));

    await waitFor(() => expect(availChain.upsert).toHaveBeenCalled());
    expect(availChain.upsert).toHaveBeenCalledWith(
      [
        { plan_id: 'p3', user_id: 'me', date_option_id: 'd1', available: true },
        { plan_id: 'p3', user_id: 'me', date_option_id: 'd2', available: true },
      ],
      { onConflict: 'plan_id,user_id,date_option_id' }
    );
  });

  it('answers a fixed plan inline with an RSVP upsert', async () => {
    primeSupabase([fixedOpen]);
    await renderFeed();
    await waitFor(() => expect(screen.getByText("I'm in")).toBeTruthy());

    await fireEvent.press(screen.getByText("I'm in"));

    await waitFor(() => expect(rsvpsChain.upsert).toHaveBeenCalled());
    expect(rsvpsChain.upsert).toHaveBeenCalledWith(
      { plan_id: 'p1', user_id: 'me', response: 'yes' },
      { onConflict: 'plan_id,user_id' }
    );
  });

  it('collapses to a changeable row when already answered', async () => {
    primeSupabase([fixedAnswered]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText("You're in")).toBeTruthy());
    expect(screen.queryByText("I'm in")).toBeNull();
    expect(screen.getByText('Change')).toBeTruthy();
  });

  // PLA-37: the card carries the same three answers as plan detail, so a full
  // plan is an invitation to queue rather than a dead end.
  it('offers the waiting list on a full plan and takes a place in it', async () => {
    const full = {
      ...fixedOpen,
      max_people: 2,
      rsvps: [
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
    };
    primeSupabase([full]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Take the next spot')).toBeTruthy());
    expect(screen.queryByText("I'm in")).toBeNull();

    await fireEvent.press(screen.getByText('Take the next spot'));

    await waitFor(() => expect(rsvpsChain.upsert).toHaveBeenCalled());
    expect(rsvpsChain.upsert).toHaveBeenCalledWith(
      { plan_id: 'p1', user_id: 'me', response: 'pending' },
      { onConflict: 'plan_id,user_id' }
    );
  });

  it('shows where you stand once you are on the list', async () => {
    const queued = {
      ...fixedOpen,
      max_people: 2,
      rsvps: [
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
        {
          user_id: 'u-ana',
          response: 'pending',
          waitlist_seq: 4,
          profile: { display_name: 'Ana' },
        },
        { user_id: 'me', response: 'pending', waitlist_seq: 9, profile: { display_name: 'Me' } },
      ],
    };
    primeSupabase([queued]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText("You're 2nd in line")).toBeTruthy());
    expect(screen.queryByText('Take the next spot')).toBeNull();
    expect(screen.queryByText("You're in")).toBeNull();
  });

  it('PLA-16: a locked plan keeps a way out, and clearing proves the row went', async () => {
    primeSupabase([lockedFlexible]);
    await renderFeed();

    // Locked cards used to render no footer at all — renderAnswer bailed on
    // anything that wasn't 'open'.
    await waitFor(() => expect(screen.getByText("You're in")).toBeTruthy());
    expect(screen.getByText('Change')).toBeTruthy();

    // Attendance is the RSVPs once locked, not the old availability — Pau was
    // free that day but never converted, so he isn't counted as going.
    expect(screen.getByText('2 going')).toBeTruthy();

    await fireEvent.press(screen.getByText('Change'));

    await waitFor(() => expect(rsvpsChain.delete).toHaveBeenCalled());
    expect(rsvpsChain.eq).toHaveBeenCalledWith('plan_id', 'p4');
    expect(rsvpsChain.eq).toHaveBeenCalledWith('user_id', 'me');
    // The .select() is the whole fix: without it RLS filtering the row out
    // comes back as a silent success.
    expect(rsvpsChain.select).toHaveBeenCalledWith('plan_id');
  });

  it('marks a confirmed plan and filters by Needs answer', async () => {
    primeSupabase([fixedAnswered, fixedOpen]);
    await renderFeed();
    await waitFor(() => expect(screen.getByText('Sunday roast')).toBeTruthy());

    // fixedAnswered has 3 yes ≥ min 3 → Confirmed badge. Exactly one match:
    // the filter chip is "Happening", so "Confirmed" now only ever names the
    // badge (PLA-43).
    expect(screen.getByText('Confirmed')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Unanswered' }));
    expect(screen.queryByText('Sunday roast')).toBeNull();
    expect(screen.getByText('Padel + pizza')).toBeTruthy();
  });

  it('shows the empty state with a create CTA', async () => {
    primeSupabase([]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Nothing on the table')).toBeTruthy());
    await fireEvent.press(screen.getByText('Start a plan'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/create');
  });

  // PLA-68: the same empty feed, and the reason for it decides what to say.
  // "Start a plan" was the one thing this user could not do.
  it('sends a user in no groups to Groups instead of the create sheet', async () => {
    primeSupabase([], { memberships: [] });
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Plans need a group first')).toBeTruthy());
    expect(screen.queryByText('Nothing on the table')).toBeNull();
    expect(screen.queryByText('Start a plan')).toBeNull();

    await fireEvent.press(screen.getByText('Sort out a group'));
    expect(mockNavigate).toHaveBeenCalledWith('/(app)/(tabs)/groups');
    expect(mockPush).not.toHaveBeenCalledWith('/(app)/plan/create');
  });

  it('keeps the plans copy for someone who has a group but no plans', async () => {
    primeSupabase([]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Nothing on the table')).toBeTruthy());
    expect(screen.queryByText('Plans need a group first')).toBeNull();
  });

  it('19e: past plans leave the feed silently at the end of their day', async () => {
    const pastPlan = { ...fixedOpen, id: 'p-past', title: 'Last week thing', event_date: iso(-3) };
    primeSupabase([fixedOpen, pastPlan]);
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Padel + pizza')).toBeTruthy());
    expect(screen.queryByText('Last week thing')).toBeNull();
  });

  it('19e: a cancellation pins one dismissable notice above the feed', async () => {
    primeSupabase([fixedOpen], {
      notices: [{ id: 'n1', data: { plan_id: 'pc' }, created_at: iso(0, 9) }],
      cancelledPlans: [
        {
          id: 'pc',
          title: 'Five-a-side at Powerleague',
          status: 'cancelled',
          event_date: iso(10),
          locked_date: null,
          cancel_reason: 'Pitch flooded',
          canceller: { display_name: 'Marcus' },
        },
      ],
    });
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Called off')).toBeTruthy());
    expect(screen.getByText('Five-a-side at Powerleague')).toBeTruthy();
    expect(screen.getByText(new RegExp('is off\\. Marcus says “Pitch flooded”'))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('see-plan-pc'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/pc');

    await fireEvent.press(screen.getByTestId('got-it-pc'));
    await waitFor(() => expect(noticesChain.update).toHaveBeenCalledWith({ read: true }));
    expect(noticesChain.eq).toHaveBeenCalledWith('id', 'n1');
  });

  it('19e: a restored plan takes its notice with it', async () => {
    primeSupabase([fixedOpen], {
      notices: [{ id: 'n1', data: { plan_id: 'pc' }, created_at: iso(0, 9) }],
      cancelledPlans: [
        {
          id: 'pc',
          title: 'Five-a-side at Powerleague',
          status: 'open',
          event_date: iso(10),
          locked_date: null,
          cancel_reason: null,
          canceller: null,
        },
      ],
    });
    await renderFeed();

    await waitFor(() => expect(screen.getByText('Padel + pizza')).toBeTruthy());
    expect(screen.queryByText('Called off')).toBeNull();
  });
});

// PLA-15: the spinner replaced the whole list, so a query that never settled
// left no error, no empty state, and no reachable pull-to-refresh.
describe('FeedScreen — when the feed cannot load', () => {
  it('shows a reason and a retry instead of spinning forever', async () => {
    mockFrom.mockImplementation(() =>
      chain({ data: null, error: new Error('Failed to reach Supabase at https://x/') })
    );
    await renderFeed();

    await waitFor(() => expect(screen.getByTestId('feed-error')).toBeTruthy());
    expect(screen.getByText("Couldn't reach Planazo")).toBeTruthy();
    expect(screen.getByTestId('feed-error-retry')).toBeTruthy();
  });

  it('recovers when the retry succeeds', async () => {
    mockFrom.mockImplementation(() =>
      chain({ data: null, error: new Error('Failed to reach Supabase at https://x/') })
    );
    await renderFeed();
    await waitFor(() => expect(screen.getByTestId('feed-error')).toBeTruthy());

    primeSupabase([fixedOpen]);
    await fireEvent.press(screen.getByTestId('feed-error-retry'));

    await waitFor(() => expect(screen.getByText('Padel + pizza')).toBeTruthy());
    expect(screen.queryByTestId('feed-error')).toBeNull();
  });
});
