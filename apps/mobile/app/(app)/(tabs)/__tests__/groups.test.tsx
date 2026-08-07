import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupsScreen from '../groups';
import { inviteCodeFrom } from '../../../../lib/inviteCode';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: jest.fn() }),
}));


const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let memberships: any[] = [];
let counts: any[] = [];
let plans: any[] = [];
let groupInvites: any[] = [];
let pendingRequests: any[] = [];
let acceptedFriendships: any[] = [];
let gmInserts: jest.Mock[] = [];

/**
 * group_members serves three queries on this screen; which result a chain
 * resolves to depends on how it was built (eq user_id = memberships,
 * in group_id = counts, insert = join). friendships resolves by the
 * status filter (pending = requests, accepted = friends).
 */
function primeSupabase() {
  gmInserts = [];
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    let kind = table;
    let status: string | null = null;
    ['select', 'order', 'single', 'or'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.eq = jest.fn((col: string, val: string) => {
      if (col === 'status') status = val;
      return c;
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
            : table === 'group_invites'
              ? { data: groupInvites, error: null }
              : table === 'friendships'
                ? { data: status === 'pending' ? pendingRequests : acceptedFriendships, error: null }
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
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  memberships = [];
  counts = [];
  plans = [];
  groupInvites = [];
  pendingRequests = [];
  acceptedFriendships = [];
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

  it('collapsed invites row counts both kinds and opens the sheet', async () => {
    memberships = [
      {
        group_id: 'g1',
        role: 'member',
        groups: { id: 'g1', name: 'Piso Gràcia', color: null, created_at: '2026-01-01' },
      },
    ];
    counts = [{ group_id: 'g1' }];
    groupInvites = [
      {
        id: 'i1',
        created_at: '2026-07-29T10:00:00Z',
        group_id: 'gx',
        groups: { id: 'gx', name: 'Padel Dilluns', color: null, group_members: [] },
        inviter: { display_name: 'Marta' },
      },
    ];
    pendingRequests = [
      {
        id: 'fr1',
        created_at: '2026-07-28T10:00:00Z',
        requester: { id: 'p9', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
      },
    ];

    await renderGroups();

    expect(await screen.findByText('2 invites')).toBeTruthy();
    expect(screen.getByText('Padel Dilluns, Aina Roig')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('invites-row'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/invites');
  });

  it('your-people row shows the friend count and opens find people', async () => {
    memberships = [
      {
        group_id: 'g1',
        role: 'member',
        groups: { id: 'g1', name: 'Piso Gràcia', color: null, created_at: '2026-01-01' },
      },
    ];
    counts = [{ group_id: 'g1' }];
    acceptedFriendships = [
      {
        requester_id: 'me',
        addressee_id: 'f1',
        requester: { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null },
        addressee: { id: 'f1', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
      },
    ];

    await renderGroups();

    expect(await screen.findByText('1 friend')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('your-people'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/find-people');

    await fireEvent.press(screen.getByTestId('find-people'));
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  // PLA-35: joining is one server-side call. The screen hands over the code
  // and never touches group_members itself.
  it('joins from a pasted invite link', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'joined', group_id: 'g9', name: 'Padel Dilluns' },
      error: null,
    });

    await renderGroups();

    const input = await screen.findByTestId('join-input');
    await fireEvent.changeText(input, 'planazo://join/ABCD2345');
    await fireEvent.press(screen.getByTestId('join-button'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('join_group_by_invite_code', { p_code: 'ABCD2345' })
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/(app)/group/g9'));
    expect(gmInserts.every((ins) => ins.mock.calls.length === 0)).toBe(true);
  });

  // PLA-49: an approval door files a request, so there is no group to open
  // yet. Same words whether this is a first ask or one quietly turned down.
  it('an approval door says the ask went in, and opens nothing', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'requested', group_id: 'g9', name: 'Padel Dilluns' },
      error: null,
    });

    await renderGroups();

    await fireEvent.changeText(await screen.findByTestId('join-input'), 'planazo://join/ABCD2345');
    await fireEvent.press(screen.getByTestId('join-button'));

    await waitFor(() =>
      expect((Alert.alert as jest.Mock).mock.calls.at(-1)![0]).toBe(
        'You’ve asked to join Padel Dilluns'
      )
    );
    expect(mockPush).not.toHaveBeenCalledWith('/(app)/group/g9');
  });

  it('an unknown code is reported, not swallowed as a join', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'not_found' }, error: null });

    await renderGroups();

    await fireEvent.changeText(await screen.findByTestId('join-input'), 'ABCD2345');
    await fireEvent.press(screen.getByTestId('join-button'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Couldn’t join', 'That link doesn’t work')
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a code for a group you are already in says so', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'already_member', group_id: 'g9', name: 'Padel Dilluns' },
      error: null,
    });

    await renderGroups();

    await fireEvent.changeText(await screen.findByTestId('join-input'), 'ABCD2345');
    await fireEvent.press(screen.getByTestId('join-button'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Couldn’t join', 'You’re already in this group')
    );
  });
});
