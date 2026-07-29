import { render, screen, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupDetailScreen from '../index';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

const mockPush = jest.fn();

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
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
  it('shows identity, role note and members, splits plans by status', async () => {
    group.plans = [
      {
        id: 'p1',
        title: 'Padel',
        plan_type: 'fixed',
        status: 'open',
        event_date: '2026-08-07T20:30:00',
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
        event_date: '2026-08-09T21:00:00',
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

  it('member role note reads member, cancelled plans stay hidden', async () => {
    group.group_members = [
      { user_id: 'me', role: 'member', profile: { id: 'me', display_name: 'Rocío' } },
    ];
    group.plans = [
      {
        id: 'p3',
        title: 'Cancelled thing',
        plan_type: 'fixed',
        status: 'cancelled',
        event_date: '2026-08-07T20:30:00',
        locked_date: null,
        min_people: 2,
        rsvps: [],
        plan_date_options: [],
      },
    ];

    await renderDetail();

    expect(await screen.findByText('You’re a member here')).toBeTruthy();
    expect(screen.queryByText('Cancelled thing')).toBeNull();
    // Every visible plan gone → empty card
    expect(screen.getByTestId('start-plan')).toBeTruthy();
  });

  it('empty group points the start-plan CTA at this group', async () => {
    await renderDetail();

    await fireEvent.press(await screen.findByTestId('start-plan'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/create?groupId=g1');
  });
});
