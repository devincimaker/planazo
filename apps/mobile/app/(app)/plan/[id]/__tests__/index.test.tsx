import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { ActionSheetIOS, Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanDetailScreen from '../index';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'plan-1' }),
  useRouter: () => ({
    push: mockPush,
    back: jest.fn(),
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    FadeInDown: {},
    FadeOutUp: {},
    LinearTransition: {},
  };
});

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

function chain(result: unknown) {
  const c: any = {};
  ['select', 'eq', 'in', 'neq', 'order', 'upsert', 'delete', 'single'].forEach((m) => {
    c[m] = jest.fn(() => c);
  });
  c.then = (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve);
  return c;
}

const basePlan = {
  id: 'plan-1',
  group_id: 'g1',
  title: 'Padel + pizza',
  description: 'Court booked at half past',
  location: 'Padel Indoor Gràcia',
  min_people: 3,
  max_people: 6,
  created_by: 'u-marta',
  creator: { display_name: 'Marta' },
  groups: { id: 'g1', name: 'Domingueros' },
};

let rsvpsChain: ReturnType<typeof chain>;
let availChain: ReturnType<typeof chain>;

function prime({
  plan,
  rsvps = [],
  options = [],
  avail = [],
  role = 'member',
  members = [],
}: {
  plan: Record<string, unknown>;
  rsvps?: unknown[];
  options?: unknown[];
  avail?: unknown[];
  role?: string;
  /** user_ids in the group — drives the nudge count and "never answered" */
  members?: string[];
}) {
  rsvpsChain = chain({ error: null });
  availChain = chain({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'plans') return chain({ data: plan, error: null });
    if (table === 'rsvps') {
      const c = chain({ data: rsvps, error: null });
      c.upsert = rsvpsChain.upsert;
      c.delete = rsvpsChain.delete;
      return c;
    }
    if (table === 'plan_date_options') return chain({ data: options, error: null });
    if (table === 'date_availability') {
      const c = chain({ data: avail, error: null });
      c.upsert = availChain.upsert;
      c.delete = availChain.delete;
      return c;
    }
    if (table === 'group_members') {
      // Two callers share the table: membership (.single() → own role) and
      // the member-id list (no .single()).
      const c = chain({ data: members.map((uid) => ({ user_id: uid })), error: null });
      c.single = jest.fn(() => chain({ data: { role }, error: null }));
      return c;
    }
    return chain({ data: null, error: null });
  });
  mockRpc.mockResolvedValue({ data: {}, error: null });
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

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <PlanDetailScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
  useAuthStore.setState({ user: { id: 'me' } as any, profile: { id: 'me' } as any });
});

/** Open the ··· menu and return the option labels + the row-select callback. */
async function openMenu() {
  await fireEvent.press(screen.getByTestId('plan-menu'));
  const call = (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1);
  return { options: call[0].options as string[], pick: call[1] as (i: number) => void };
}

describe('PlanDetailScreen — fixed plans', () => {
  it('tells the gap below minimum and answers via upsert', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: '2026-08-06T19:30:00Z' },
      rsvps: [
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("1 more and it's on")).toBeTruthy());
    expect(screen.getByText('Happens with 3 · caps at 6')).toBeTruthy();

    await fireEvent.press(screen.getByText("I'm in"));
    await waitFor(() =>
      expect(rsvpsChain.upsert).toHaveBeenCalledWith(
        { plan_id: 'plan-1', user_id: 'me', response: 'yes' },
        { onConflict: 'plan_id,user_id' }
      )
    );
  });

  it('flips to "It\'s on" once the minimum is met and collapses my answer', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: '2026-08-06T19:30:00Z' },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("It's on")).toBeTruthy());
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('3 in · room for 3 more')).toBeTruthy();
    expect(screen.getByText("You're in")).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });
});

describe('PlanDetailScreen — flexible plans', () => {
  const options = [
    { id: 'd1', date: '2026-08-13T12:00:00Z' },
    { id: 'd2', date: '2026-08-14T12:00:00Z' },
  ];

  it('tracks the leading date in the headline and sends picked dates', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'flexible', status: 'open', event_date: null },
      options,
      avail: [
        { id: 'a1', date_option_id: 'd1', user_id: 'u-aina', profile: { display_name: 'Aina' } },
        { id: 'a2', date_option_id: 'd1', user_id: 'u-jordi', profile: { display_name: 'Jordi' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('1 more on Thu 13 Aug')).toBeTruthy());
    expect(screen.getByText('Leading')).toBeTruthy();
    expect(screen.getByText('Tap the dates you can do')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('vote-d2'));
    await fireEvent.press(screen.getByText('Send 1 date'));

    await waitFor(() =>
      expect(availChain.upsert).toHaveBeenCalledWith(
        [{ plan_id: 'plan-1', user_id: 'me', date_option_id: 'd2', available: true }],
        { onConflict: 'plan_id,user_id,date_option_id' }
      )
    );
  });

  it('lets the host lock in the viable leading date via the RPC', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'flexible',
        status: 'open',
        event_date: null,
        created_by: 'me',
      },
      options,
      avail: [
        { id: 'a1', date_option_id: 'd1', user_id: 'u-aina', profile: { display_name: 'Aina' } },
        { id: 'a2', date_option_id: 'd1', user_id: 'u-jordi', profile: { display_name: 'Jordi' } },
        { id: 'a3', date_option_id: 'd1', user_id: 'u-pau', profile: { display_name: 'Pau' } },
      ],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('lock-in')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('lock-in'));

    // Confirm dialog → press "Lock in"
    const alertCall = (Alert.alert as jest.Mock).mock.calls.at(-1);
    const lockButton = alertCall[2].find((b: any) => b.text === 'Lock in');
    lockButton.onPress();

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('lock_plan', {
        p_plan_id: 'plan-1',
        p_date_option_id: 'd1',
      })
    );
  });

  it('locked plans ask for a plain yes/no and offer the host a reopen', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'flexible',
        status: 'locked',
        locked_date: '2026-08-13T20:00:00Z',
        event_date: null,
        created_by: 'me',
      },
      options,
      avail: [],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("It's on")).toBeTruthy());
    expect(screen.getByText("I'm in")).toBeTruthy();
    expect(screen.queryByText('Which days work')).toBeNull();

    await fireEvent.press(screen.getByTestId('reopen'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('reopen_plan', { p_plan_id: 'plan-1' })
    );
  });

});

describe('PlanDetailScreen — the 20a menu', () => {
  it("host menu carries Call it off and routes to the confirm sheet; nudge counts the silent", async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'fixed',
        status: 'open',
        event_date: iso(8),
        created_by: 'me',
      },
      rsvps: [{ user_id: 'me', response: 'yes', profile: { display_name: 'Me' } }],
      members: ['me', 'u-marta', 'u-jordi', 'u-aina'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    const { options, pick } = await openMenu();
    expect(options).toEqual([
      'Copy invite link',
      "Nudge the 3 who haven't answered",
      'Call it off',
      'Cancel',
    ]);

    pick(2);
    expect(mockPush).toHaveBeenCalledWith('/plan/plan-1/cancel');
  });

  it('back falls back to the group screen after a deep link', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('back')).toBeTruthy());

    mockCanGoBack = false;
    await fireEvent.press(screen.getByTestId('back'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/group/g1');
  });

  it('guests get the same menu minus Call it off', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(8) },
      members: ['me', 'u-marta'],
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    const { options } = await openMenu();
    expect(options).not.toContain('Call it off');
    expect(options).toContain('Copy invite link');
  });
});

describe('PlanDetailScreen — endings', () => {
  const cancelledPlan = {
    ...basePlan,
    plan_type: 'fixed',
    status: 'cancelled',
    event_date: iso(10),
    cancelled_at: iso(-1, 18),
    cancelled_by: 'u-marta',
    cancel_reason: 'Pitch flooded, they’ve shut the whole site till Monday.',
    canceller: { display_name: 'Marta' },
  };

  it('19a: called off shows the stone card and removes the footer entirely', async () => {
    prime({
      plan: cancelledPlan,
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
      members: ['me', 'u-marta', 'u-jordi'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('Called off')).toBeTruthy());
    expect(screen.getByText('Marta called this off')).toBeTruthy();
    expect(
      screen.getByText('“Pitch flooded, they’ve shut the whole site till Monday.”')
    ).toBeTruthy();
    expect(screen.getByText('Was going')).toBeTruthy();
    // Footer gone — no answer buttons, no reopen for a guest
    expect(screen.queryByText("I'm in")).toBeNull();
    expect(screen.queryByTestId('restore')).toBeNull();
    // The count is a question and there's no question left
    expect(screen.queryByTestId('slot-filled')).toBeNull();
  });

  it('19b: the host sees Reopen while the date is ahead, wired to restore_plan', async () => {
    prime({
      plan: { ...cancelledPlan, created_by: 'me', cancelled_by: 'me', canceller: null },
      rsvps: [{ user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } }],
      members: ['me', 'u-jordi'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('You called this off')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('restore'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('restore_plan', { p_plan_id: 'plan-1' })
    );
  });

  it('19b: reopen disappears once the date has passed', async () => {
    prime({
      plan: { ...cancelledPlan, created_by: 'me', cancelled_by: 'me', event_date: iso(-3) },
      members: ['me'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText('You called this off')).toBeTruthy());
    expect(screen.queryByTestId('restore')).toBeNull();
  });

  it("19c: didn't happen — frozen count, the explanation line, and try again", async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(-2) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-pau', response: 'no', profile: { display_name: 'Pau' } },
      ],
      members: ['me', 'u-marta', 'u-jordi', 'u-pau'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("Didn't happen")).toBeTruthy());
    expect(screen.getByText('Two short on the night')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    expect(screen.getByText('The date passed before it reached its minimum')).toBeTruthy();
    expect(screen.getByText('Were in')).toBeTruthy();
    expect(screen.getByText("2 never answered · 1 couldn't make it")).toBeTruthy();
    expect(screen.queryByText("I'm in")).toBeNull();

    await fireEvent.press(screen.getByTestId('try-again'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/plan/create',
      params: {
        groupId: 'g1',
        title: 'Padel + pizza',
        min: '3',
        cap: '6',
        location: 'Padel Indoor Gràcia',
        details: '1',
      },
    });
  });

  it('a past plan that reached its minimum simply happened — detail unchanged', async () => {
    prime({
      plan: { ...basePlan, plan_type: 'fixed', status: 'open', event_date: iso(-2) },
      rsvps: [
        { user_id: 'me', response: 'yes', profile: { display_name: 'Me' } },
        { user_id: 'u-marta', response: 'yes', profile: { display_name: 'Marta' } },
        { user_id: 'u-jordi', response: 'yes', profile: { display_name: 'Jordi' } },
      ],
      members: ['me', 'u-marta', 'u-jordi'],
    });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("It's on")).toBeTruthy());
    expect(screen.queryByText("Didn't happen")).toBeNull();
  });
});

// PLA-19: an unknown or RLS-hidden plan used to spin forever. `.single()` throws
// PGRST116, the query settles with no data, and the guard had no error branch.
describe('PlanDetailScreen — a plan you cannot see', () => {
  const notFound = {
    code: 'PGRST116',
    message: 'JSON object requested, multiple (or no) rows returned',
  };

  function primeMissing(planResult: unknown) {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'plans') return chain(planResult);
      return chain({ data: [], error: null });
    });
    mockRpc.mockResolvedValue({ data: {}, error: null });
  }

  it('says so instead of spinning forever', async () => {
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error')).toBeTruthy());
    expect(screen.getByText("This plan isn't here")).toBeTruthy();
    expect(screen.queryByTestId('plan-error-retry')).toBeNull();
  });

  it('offers a way back when there is a screen behind it', async () => {
    mockCanGoBack = true;
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error-back')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('plan-error-back'));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('sends a cold deep link to the feed, since there is nothing to go back to', async () => {
    mockCanGoBack = false;
    primeMissing({ data: null, error: notFound });
    await renderDetail();

    await waitFor(() => expect(screen.getByTestId('plan-error-back')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('plan-error-back'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
  });

  it('offers a retry when the fetch failed rather than came back empty', async () => {
    primeMissing({ data: null, error: new Error('Failed to reach Supabase at https://x/') });
    await renderDetail();

    await waitFor(() => expect(screen.getByText("Couldn't reach Planazo")).toBeTruthy());
    expect(screen.getByTestId('plan-error-retry')).toBeTruthy();
  });
});

