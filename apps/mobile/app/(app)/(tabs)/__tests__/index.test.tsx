import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FeedScreen from '../index';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockFrom = supabase.from as jest.Mock;

/** Chainable, awaitable Supabase query-builder stub. */
function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'in', 'neq', 'order', 'upsert', 'delete'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

const GROUP = { id: 'g1', name: 'Domingueros' };

const fixedOpen = {
  id: 'p1',
  title: 'Padel + pizza',
  plan_type: 'fixed',
  status: 'open',
  min_people: 3,
  event_date: '2026-08-06T19:30:00Z',
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

let plansChain: ReturnType<typeof chain>;
let rsvpsChain: ReturnType<typeof chain>;

function primeSupabase(plans: unknown[]) {
  plansChain = chain({ data: plans, error: null });
  rsvpsChain = chain({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'group_members') return chain({ data: [{ group_id: 'g1' }], error: null });
    if (table === 'plans') return plansChain;
    if (table === 'rsvps') return rsvpsChain;
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
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
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

  it('marks a confirmed plan and filters by Needs answer', async () => {
    primeSupabase([fixedAnswered, fixedOpen]);
    await renderFeed();
    await waitFor(() => expect(screen.getByText('Sunday roast')).toBeTruthy());

    // fixedAnswered has 3 yes ≥ min 3 → Confirmed badge
    expect(screen.getByText('Confirmed')).toBeTruthy();

    await fireEvent.press(screen.getByText('Needs answer'));
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
});
