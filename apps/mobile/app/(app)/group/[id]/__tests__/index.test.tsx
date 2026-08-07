import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MIN_TOUCH_TARGET } from '../../../../../lib/a11y';
import GroupDetailScreen from '../index';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';
import { iso } from '../../../../../lib/testing/dates';

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

  /**
   * The count beside min_people is the best single date, never the union of
   * everyone free on any date. Three people each free on a different day is a
   * plan going nowhere, and the row used to call it "3 going" while the plan
   * screen said "3 more and it's on".
   */
  const flexiblePlan = (plan_date_options: unknown[]) => ({
    plan_type: 'flexible',
    status: 'open',
    event_date: null,
    locked_date: null,
    min_people: 3,
    rsvps: [],
    plan_date_options,
  });
  const free = (id: string, name: string) => ({ user_id: id, profile: { display_name: name } });

  /** One person per date, so no single evening ever has more than one. */
  const spreadThin = (days: number[]) =>
    flexiblePlan(
      days.map((d, i) => ({
        id: `o${i + 1}`,
        date: iso(d),
        date_availability: [free(`u${i + 1}`, `P${i + 1}`)],
      }))
    );

  /** Three free on the lead day, one of them also free on the other. */
  const threeOnOneDay = (leadDay: number, otherDay: number) =>
    flexiblePlan([
      {
        id: 'o1',
        date: iso(leadDay),
        date_availability: [free('u1', 'Aina'), free('u2', 'Pau'), free('u3', 'Jordi')],
      },
      { id: 'o2', date: iso(otherDay), date_availability: [free('u1', 'Aina')] },
    ]);

  it('counts the best single date, not everyone free on any date', async () => {
    group.plans = [{ ...spreadThin([3, 4, 5]), id: 'pf', title: 'Vermut algun dia' }];

    await renderDetail();

    expect(await screen.findByText('Vermut algun dia')).toBeTruthy();
    expect(screen.getByText('3 dates on the table')).toBeTruthy();
    expect(screen.getByText('1 of 3 needed')).toBeTruthy();
    expect(screen.queryByText('3 going')).toBeNull();
  });

  it('sinks a spread-thin plan into Past as never-quite, not as happened', async () => {
    group.plans = [{ ...spreadThin([-6, -5, -4]), id: 'pf', title: 'Vermut algun dia' }];

    await renderDetail();
    await fireEvent.press(await screen.findByTestId('past-toggle'));

    expect(screen.getByText("Didn't happen · 1 of 3")).toBeTruthy();
    expect(screen.queryByText('3 went')).toBeNull();
  });

  it('calls a flexible plan on once one date reaches the minimum', async () => {
    group.plans = [
      { ...threeOnOneDay(3, 4), id: 'pl', title: 'Calçotada' },
      { ...threeOnOneDay(-5, -4), id: 'pp', title: 'Calçotada passada' },
    ];

    await renderDetail();

    expect(await screen.findByText('3 going')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('past-toggle'));
    // Nobody holds a yes on a flexible plan that never locked, so the went
    // label falls back to the count that made it happen.
    expect(screen.getByText('3 went')).toBeTruthy();
    expect(screen.queryByText("Didn't happen · 3 of 3")).toBeNull();
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
