import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BlockedPeopleScreen from '../blocked';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';
import { unblockUser } from '../../../../lib/moderation';

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('../../../../lib/moderation', () => ({
  ...jest.requireActual('../../../../lib/moderation'),
  unblockUser: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockFrom = supabase.from as jest.Mock;
const mockUnblock = unblockUser as jest.Mock;

let blockedRows: any[] = [];
let profileRows: any[] = [];

function primeSupabase() {
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    ['select', 'order', 'in', 'eq'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.then = (resolve: (v: unknown) => void) => {
      const result =
        table === 'blocked_users'
          ? { data: blockedRows, error: null }
          : table === 'profiles'
            ? { data: profileRows, error: null }
            : { data: [], error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderBlocked() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <BlockedPeopleScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  blockedRows = [];
  profileRows = [];
  primeSupabase();
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
});

describe('BlockedPeopleScreen', () => {
  it('says so when nobody is blocked', async () => {
    await renderBlocked();
    expect(await screen.findByTestId('blocked-empty')).toBeTruthy();
  });

  it('lists blocked people, most recent first, with an Unblock each', async () => {
    blockedRows = [
      { blocked_id: 'p2', created_at: '2026-08-02' },
      { blocked_id: 'p1', created_at: '2026-08-01' },
    ];
    profileRows = [
      { id: 'p1', display_name: 'Jordi Puig', handle: 'jordipuig', avatar_url: null },
      { id: 'p2', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
    ];

    await renderBlocked();

    expect(await screen.findByText('Aina Roig')).toBeTruthy();
    expect(screen.getByText('Jordi Puig')).toBeTruthy();
    expect(screen.getByTestId('unblock-p1')).toBeTruthy();
  });

  it('Unblock calls through with the right pair', async () => {
    blockedRows = [{ blocked_id: 'p1', created_at: '2026-08-01' }];
    profileRows = [{ id: 'p1', display_name: 'Jordi Puig', handle: 'jordipuig', avatar_url: null }];

    await renderBlocked();

    await fireEvent.press(await screen.findByTestId('unblock-p1'));
    await waitFor(() => expect(mockUnblock).toHaveBeenCalledWith('me', 'p1'));
  });
});
