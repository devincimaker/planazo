import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InvitesSheet, { timeAgo } from '../invites';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';

const mockBack = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, navigate: jest.fn() }),
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
    FadeOutUp: {},
    LinearTransition: {},
  };
});

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let groupInvites: any[] = [];
let pendingRequests: any[] = [];

function primeSupabase() {
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    ['select', 'eq', 'or', 'order', 'in', 'single'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.then = (resolve: (v: unknown) => void) => {
      const result =
        table === 'group_invites'
          ? { data: groupInvites, error: null }
          : table === 'friendships'
            ? { data: pendingRequests, error: null }
            : { data: [], error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderSheet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <InvitesSheet />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  primeSupabase();
  mockRpc.mockResolvedValue({ data: { status: 'accepted' }, error: null });
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
  groupInvites = [
    {
      id: 'i1',
      created_at: '2026-07-29T10:00:00Z',
      group_id: 'gx',
      groups: {
        id: 'gx',
        name: 'Padel Dilluns',
        color: '#B7E4C7',
        group_members: [
          { profile: { display_name: 'Marta' } },
          { profile: { display_name: 'Jordi' } },
          { profile: { display_name: 'Aina' } },
        ],
      },
      inviter: { display_name: 'Marta' },
    },
  ];
  pendingRequests = [
    {
      id: 'fr1',
      created_at: '2026-07-28T09:00:00Z',
      requester: { id: 'p9', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
    },
  ];
});

describe('timeAgo', () => {
  it('buckets minutes, hours and days', () => {
    const now = Date.now();
    expect(timeAgo(new Date(now - 30 * 1000).toISOString())).toBe('just now');
    expect(timeAgo(new Date(now - 5 * 60 * 1000).toISOString())).toBe('5m ago');
    expect(timeAgo(new Date(now - 3 * 3600 * 1000).toISOString())).toBe('3h ago');
    expect(timeAgo(new Date(now - 26 * 3600 * 1000).toISOString())).toBe('yesterday');
    expect(timeAgo(new Date(now - 3 * 24 * 3600 * 1000).toISOString())).toBe('3 days ago');
  });
});

describe('InvitesSheet', () => {
  it('renders both card kinds with their who-lines', async () => {
    await renderSheet();

    expect(await screen.findByText('Padel Dilluns')).toBeTruthy();
    expect(screen.getByText('Group invite')).toBeTruthy();
    // Inviter bolded, other members listed
    expect(screen.getByText(/invited you · Jordi, Aina/)).toBeTruthy();

    expect(screen.getByText('Friend request')).toBeTruthy();
    expect(screen.getByText('Aina Roig')).toBeTruthy();
    expect(screen.getByText(/@ainaroig/)).toBeTruthy();
  });

  it('joining a group goes through the RPC', async () => {
    await renderSheet();

    await fireEvent.press(await screen.findByTestId('invite-join-i1'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('respond_group_invite', {
        p_invite_id: 'i1',
        p_accept: true,
      })
    );
  });

  it('ignoring a friend request goes through the RPC', async () => {
    await renderSheet();

    await fireEvent.press(await screen.findByTestId('request-ignore-fr1'));
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('respond_friend_request', {
        p_friendship_id: 'fr1',
        p_accept: false,
      })
    );
  });

  it('empty state and Done', async () => {
    groupInvites = [];
    pendingRequests = [];
    await renderSheet();

    expect(await screen.findByText(/All clear/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('done'));
    expect(mockBack).toHaveBeenCalled();
  });
});
