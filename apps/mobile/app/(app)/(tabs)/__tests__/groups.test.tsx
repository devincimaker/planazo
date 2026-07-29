import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupsScreen, { inviteCodeFrom } from '../groups';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let memberships: any[] = [];
let counts: any[] = [];
let plans: any[] = [];
let gmInserts: jest.Mock[] = [];

/**
 * group_members serves three queries on this screen; which result a chain
 * resolves to depends on how it was built (eq user_id = memberships,
 * in group_id = counts, insert = join).
 */
function primeSupabase() {
  gmInserts = [];
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    let kind = table;
    ['select', 'eq', 'order', 'single'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.in = jest.fn(() => {
      if (table === 'group_members') kind = 'counts';
      return c;
    });
    c.insert = jest.fn(() => {
      kind = 'insert';
      return c;
    });
    if (table === 'group_members') gmInserts.push(c.insert);
    c.then = (resolve: (v: unknown) => void) => {
      const result =
        kind === 'insert'
          ? { error: null }
          : kind === 'counts'
            ? { data: counts, error: null }
            : kind === 'group_members'
              ? { data: memberships, error: null }
              : { data: plans, error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderGroups() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupsScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  memberships = [];
  counts = [];
  plans = [];
  primeSupabase();
  mockRpc.mockResolvedValue({ data: null, error: null });
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
});

describe('inviteCodeFrom', () => {
  it('finds a code in a link, a raw code, and rejects garbage', () => {
    expect(inviteCodeFrom('planazo://join/ABCD2345')).toBe('ABCD2345');
    expect(inviteCodeFrom('abcd2345')).toBe('ABCD2345');
    expect(inviteCodeFrom('join my group!')).toBeNull();
    // 0, 1, I and O are not in the code alphabet
    expect(inviteCodeFrom('ABC10OI2')).toBeNull();
  });
});

describe('GroupsScreen', () => {
  it('lists groups with headcount and an ember needs-you count', async () => {
    memberships = [
      {
        group_id: 'g1',
        role: 'admin',
        groups: { id: 'g1', name: 'Piso Gràcia', color: '#F7B0DC', created_at: '2026-01-01' },
      },
      {
        group_id: 'g2',
        role: 'member',
        groups: { id: 'g2', name: 'Cine i sopar', color: '#B7E4C7', created_at: '2026-01-02' },
      },
    ];
    counts = [
      { group_id: 'g1' },
      { group_id: 'g1' },
      { group_id: 'g1' },
      { group_id: 'g1' },
      { group_id: 'g2' },
    ];
    // Open fixed plan in g1 with no answer from me: waiting on me.
    plans = [
      {
        id: 'p1',
        group_id: 'g1',
        plan_type: 'fixed',
        status: 'open',
        min_people: 2,
        rsvps: [{ user_id: 'other', response: 'yes' }],
        plan_date_options: [],
      },
    ];

    await renderGroups();

    expect(await screen.findByText('Piso Gràcia')).toBeTruthy();
    expect(screen.getByText('4 people')).toBeTruthy();
    expect(screen.getByText(/1 plan waiting on you/)).toBeTruthy();
    expect(screen.getByText('Cine i sopar')).toBeTruthy();
    expect(screen.getByText('1 person')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('group-row-g2'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/group/g2');
  });

  it('answered plans do not count as waiting', async () => {
    memberships = [
      {
        group_id: 'g1',
        role: 'member',
        groups: { id: 'g1', name: 'Piso Gràcia', color: null, created_at: '2026-01-01' },
      },
    ];
    counts = [{ group_id: 'g1' }];
    plans = [
      {
        id: 'p1',
        group_id: 'g1',
        plan_type: 'fixed',
        status: 'open',
        min_people: 2,
        rsvps: [{ user_id: 'me', response: 'yes' }],
        plan_date_options: [],
      },
    ];

    await renderGroups();

    expect(await screen.findByText('Piso Gràcia')).toBeTruthy();
    expect(screen.queryByText(/waiting on you/)).toBeNull();
  });

  it('day one: join field and create button, no header pill', async () => {
    await renderGroups();

    expect(await screen.findByTestId('join-input')).toBeTruthy();
    expect(screen.getByTestId('create-group')).toBeTruthy();
    expect(screen.queryByTestId('new-group')).toBeNull();

    await fireEvent.press(screen.getByTestId('create-group'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/group/new');
  });

  it('joins from a pasted invite link', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'g9', name: 'Padel Dilluns' }], error: null });

    await renderGroups();

    const input = await screen.findByTestId('join-input');
    await fireEvent.changeText(input, 'planazo://join/ABCD2345');
    await fireEvent.press(screen.getByTestId('join-button'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('get_group_by_invite_code', { code: 'ABCD2345' })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(app)/group/g9'));
    expect(gmInserts.some((ins) => ins.mock.calls.length > 0)).toBe(true);
  });
});
