import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MIN_TOUCH_TARGET } from '../../../../../lib/a11y';
import GroupDetailScreen from '../index';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
    navigate: jest.fn(),
  }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));


const mockFrom = supabase.from as jest.Mock;

let group: any;

function chain(result: () => unknown) {
  const c: any = {};
  ['select', 'eq', 'single'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result()).then(resolve);
  return c;
}

async function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupDetailScreen />
    </QueryClientProvider>
  );
}

/**
 * ISO timestamp N days from today at the given hour, local time. Module scope
 * so every fixture can reach it: the group screen sorts upcoming plans away
 * from past ones, so a literal date silently changes what a test is asserting
 * the day after it passes.
 */
function iso(days: number, hour = 19) {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, 0, 0).toISOString();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockFrom.mockImplementation(() => chain(() => ({ data: group, error: null })));
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
  group = {
    id: 'g1',
    name: 'Piso Gràcia',
    description: 'The flat, plus honorary members',
    color: '#F7B0DC',
    invite_code: 'ABCD2345',
    group_members: [
      { user_id: 'me', role: 'admin', profile: { id: 'me', display_name: 'Rocío' } },
      { user_id: 'u2', role: 'member', profile: { id: 'u2', display_name: 'Aina' } },
    ],
    plans: [],
  };
});

describe('GroupDetailScreen', () => {
  /**
   * PLA-40. Back, "Manage" and "Invite" were all bare words: the nav row was
   * 40pt tall around 20pt targets, and "Invite" sat in a row sized by the
   * 30pt avatar stack beside it. Each is a real 44 now, reached by moving the
   * container's padding onto the button rather than by invisible hitSlop.
   */
  it('gives its nav actions the 44pt minimum', async () => {
    await renderDetail();
    await screen.findByTestId('manage');

    for (const id of ['back', 'manage', 'invite']) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('shows identity, role note and members, splits plans by status', async () => {
    group.plans = [
      {
        id: 'p1',
        title: 'Padel',
        plan_type: 'fixed',
        status: 'open',
        event_date: iso(2, 20),
        locked_date: null,
        min_people: 4,
        rsvps: [{ user_id: 'me', response: 'yes' }],
        plan_date_options: [],
      },
      {
        id: 'p2',
        title: 'Sopar de festa',
        plan_type: 'fixed',
        status: 'locked',
        event_date: iso(4, 21),
        locked_date: null,
        min_people: 2,
        rsvps: [
          { user_id: 'me', response: 'yes' },
          { user_id: 'u2', response: 'yes' },
        ],
        plan_date_options: [],
      },
    ];

    await renderDetail();

    expect(await screen.findByText('Piso Gràcia')).toBeTruthy();
    expect(screen.getByText('You run this group')).toBeTruthy();
    expect(screen.getByText('The flat, plus honorary members')).toBeTruthy();
    expect(screen.getByText('2 people')).toBeTruthy();

    expect(screen.getByText('Waiting on answers · 1')).toBeTruthy();
    expect(screen.getByText('Locked in · 1')).toBeTruthy();
    expect(screen.getByText('1 of 4 needed')).toBeTruthy();
    expect(screen.getByText('2 going')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('plan-row-p1'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/p1');
  });

  it('member role note reads member, cancelled plans fall through to Past', async () => {
    group.group_members = [
      { user_id: 'me', role: 'member', profile: { id: 'me', display_name: 'Rocío' } },
    ];
    group.plans = [
      {
        id: 'p3',
        title: 'Cancelled thing',
        plan_type: 'fixed',
        status: 'cancelled',
        event_date: iso(2, 20),
        locked_date: null,
        min_people: 2,
        cancelled_by: 'u2',
        canceller: { display_name: 'Aina' },
        rsvps: [],
        plan_date_options: [],
      },
    ];

    await renderDetail();

    expect(await screen.findByText('You’re a member here')).toBeTruthy();
    // Closed by default — it costs one line until you want it
    expect(screen.queryByText('Cancelled thing')).toBeNull();
    // No live plans → empty card still invites a start
    expect(screen.getByTestId('start-plan')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('past-toggle'));
    expect(screen.getByText('Cancelled thing')).toBeTruthy();
    expect(screen.getByText('Called off by Aina')).toBeTruthy();
  });

  it('19d: one Past section, three endings', async () => {
    const base = { plan_type: 'fixed', locked_date: null, plan_date_options: [] };
    group.plans = [
      { ...base, id: 'pl', title: 'Upcoming padel', status: 'open', event_date: iso(5), min_people: 2, rsvps: [] },
      {
        ...base, id: 'pc', title: 'Five-a-side', status: 'cancelled', event_date: iso(3),
        min_people: 3, cancelled_by: 'me', canceller: { display_name: 'Rocío' }, rsvps: [],
      },
      {
        ...base, id: 'pe', title: 'Pub quiz', status: 'open', event_date: iso(-4), min_people: 4,
        rsvps: [{ user_id: 'me', response: 'yes', profile: { display_name: 'Rocío' } }],
      },
      {
        ...base, id: 'ph', title: 'Went well', status: 'open', event_date: iso(-10), min_people: 2,
        rsvps: [
          { user_id: 'me', response: 'yes', profile: { display_name: 'Rocío' } },
          { user_id: 'u2', response: 'yes', profile: { display_name: 'Aina' } },
          { user_id: 'u3', response: 'yes', profile: { display_name: 'Pau' } },
        ],
      },
    ];

    await renderDetail();

    expect(await screen.findByText('Upcoming padel')).toBeTruthy();
    expect(screen.getByText('Past')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('past-toggle'));
    expect(screen.getByText('Called off by you')).toBeTruthy();
    expect(screen.getByText("Didn't happen · 1 of 4")).toBeTruthy();
    expect(screen.getByText('You and 2 others went')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('past-row-ph'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/ph');
  });

  it('empty group points the start-plan CTA at this group', async () => {
    await renderDetail();

    await fireEvent.press(await screen.findByTestId('start-plan'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/create?groupId=g1');
  });

  it('back pops history, or falls back to the Groups tab after a deep link', async () => {
    await renderDetail();
    await fireEvent.press(await screen.findByTestId('back'));
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    mockCanGoBack = false;
    await fireEvent.press(screen.getByTestId('back'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)/groups');
  });
});
