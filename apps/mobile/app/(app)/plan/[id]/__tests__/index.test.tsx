import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PlanDetailScreen from '../index';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'plan-1' }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

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
}: {
  plan: Record<string, unknown>;
  rsvps?: unknown[];
  options?: unknown[];
  avail?: unknown[];
  role?: string;
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
    if (table === 'group_members') return chain({ data: { role }, error: null });
    return chain({ data: null, error: null });
  });
  mockRpc.mockResolvedValue({ data: {}, error: null });
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
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useAuthStore.setState({ user: { id: 'me' } as any, profile: { id: 'me' } as any });
});

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

  it('host cancel flows through the cancel_plan RPC', async () => {
    prime({
      plan: {
        ...basePlan,
        plan_type: 'fixed',
        status: 'open',
        event_date: '2026-08-06T19:30:00Z',
        created_by: 'me',
      },
    });
    await renderDetail();
    await waitFor(() => expect(screen.getByTestId('plan-menu')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('plan-menu'));
    let buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    buttons.find((b: any) => b.text === 'Cancel plan').onPress();
    buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)[2];
    buttons.find((b: any) => b.text === 'Cancel plan').onPress();

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('cancel_plan', { p_plan_id: 'plan-1' })
    );
  });
});
