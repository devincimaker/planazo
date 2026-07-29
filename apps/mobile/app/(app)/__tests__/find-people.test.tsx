import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FindPeopleScreen from '../find-people';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let acceptedFriendships: any[] = [];
let pendingFriendships: any[] = [];
let sharedGroups: any[] = [];
let searchResults: any[] = [];

function primeSupabase() {
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    let status: string | null = null;
    ['select', 'or', 'neq', 'limit', 'order', 'single', 'in'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.eq = jest.fn((col: string, val: string) => {
      if (col === 'status') status = val;
      return c;
    });
    c.then = (resolve: (v: unknown) => void) => {
      const result =
        table === 'friendships'
          ? { data: status === 'accepted' ? acceptedFriendships : pendingFriendships, error: null }
          : table === 'group_members'
            ? { data: sharedGroups, error: null }
            : table === 'profiles'
              ? { data: searchResults, error: null }
              : { data: [], error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderFind() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <FindPeopleScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  acceptedFriendships = [];
  pendingFriendships = [];
  sharedGroups = [];
  searchResults = [];
  primeSupabase();
  mockRpc.mockResolvedValue({ data: { status: 'requested' }, error: null });
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
});

describe('FindPeopleScreen', () => {
  it('suggests shared-group people you have not added, with the group note', async () => {
    sharedGroups = [
      {
        group_id: 'g1',
        groups: {
          name: 'Piso Gràcia',
          group_members: [
            { user_id: 'me', profile: { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null } },
            { user_id: 'p1', profile: { id: 'p1', display_name: 'Jordi Puig', handle: 'jordipuig', avatar_url: null } },
          ],
        },
      },
    ];

    await renderFind();

    expect(await screen.findByText('Jordi Puig')).toBeTruthy();
    expect(screen.getByText(/both in Piso Gràcia/)).toBeTruthy();
    expect(screen.getByText("You've planned together")).toBeTruthy();
  });

  it('Add sends a request and flips to Requested in place', async () => {
    sharedGroups = [
      {
        group_id: 'g1',
        groups: {
          name: 'Piso Gràcia',
          group_members: [
            { user_id: 'p1', profile: { id: 'p1', display_name: 'Jordi Puig', handle: 'jordipuig', avatar_url: null } },
          ],
        },
      },
    ];

    await renderFind();

    await fireEvent.press(await screen.findByTestId('add-p1'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('send_friend_request', { p_addressee: 'p1' })
    );
    await screen.findByTestId('requested-p1');
    expect(screen.getByText('Requested')).toBeTruthy();
  });

  it('typing searches and marks existing friends', async () => {
    acceptedFriendships = [
      {
        requester_id: 'me',
        addressee_id: 'f1',
        requester: { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null },
        addressee: { id: 'f1', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
      },
    ];
    searchResults = [
      { id: 'f1', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
      { id: 'p2', display_name: 'Ainhoa Vidal', handle: 'ainhoav', avatar_url: null },
    ];

    await renderFind();

    await fireEvent.changeText(screen.getByTestId('search-input'), 'ain');

    expect(await screen.findByText('Results')).toBeTruthy();
    expect(await screen.findByText('Ainhoa Vidal')).toBeTruthy();
    expect(screen.getByText('Friends')).toBeTruthy();
    expect(screen.getByTestId('add-p2')).toBeTruthy();
  });

  it('incoming requesters get Accept instead of Add', async () => {
    pendingFriendships = [{ requester_id: 'p3', addressee_id: 'me', status: 'pending' }];
    searchResults = [{ id: 'p3', display_name: 'Marc Sainz', handle: 'marcsainz', avatar_url: null }];

    await renderFind();

    await fireEvent.changeText(screen.getByTestId('search-input'), 'marc');
    expect(await screen.findByText('Accept')).toBeTruthy();
  });
});
