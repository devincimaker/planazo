import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManageGroupScreen from '../manage';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

const mockNavigate = jest.fn();
const mockPush = jest.fn();

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: mockNavigate }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let group: any;
let groupUpdates: jest.Mock[] = [];
let gmUpdates: jest.Mock[] = [];
let gmDeletes: jest.Mock[] = [];

function primeSupabase() {
  groupUpdates = [];
  gmUpdates = [];
  gmDeletes = [];
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    let mutation = false;
    ['select', 'eq', 'single'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.update = jest.fn(() => {
      mutation = true;
      return c;
    });
    c.delete = jest.fn(() => {
      mutation = true;
      return c;
    });
    if (table === 'groups') groupUpdates.push(c.update);
    if (table === 'group_members') {
      gmUpdates.push(c.update);
      gmDeletes.push(c.delete);
    }
    c.then = (resolve: (v: unknown) => void) => {
      const result = mutation ? { error: null } : { data: group, error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderManage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ManageGroupScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');
  primeSupabase();
  mockRpc.mockResolvedValue({ data: { left: true }, error: null });
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
  group = {
    id: 'g1',
    name: 'Piso Gràcia',
    color: '#F7B0DC',
    invite_code: 'ABCD2345',
    anyone_can_post: true,
    group_members: [
      {
        user_id: 'me',
        role: 'admin',
        notify_new_plans: true,
        joined_at: '2026-01-01',
        profile: { display_name: 'Rocío', avatar_url: null },
      },
      {
        user_id: 'u2',
        role: 'member',
        notify_new_plans: true,
        joined_at: '2026-01-02',
        profile: { display_name: 'Aina', avatar_url: null },
      },
    ],
  };
});

describe('ManageGroupScreen', () => {
  it('admin sees themselves first, can promote a member', async () => {
    await renderManage();

    expect(await screen.findByText(/· you/)).toBeTruthy();
    expect(screen.getByText('Aina')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('role-u2'));
    await waitFor(() =>
      expect(gmUpdates.some((u) => u.mock.calls.some((call) => call[0]?.role === 'admin'))).toBe(
        true
      )
    );
  });

  it('remove asks first, then deletes the membership', async () => {
    await renderManage();

    await fireEvent.press(await screen.findByTestId('remove-u2'));
    expect(Alert.alert).toHaveBeenCalledWith(
      'Remove Aina?',
      expect.any(String),
      expect.any(Array)
    );

    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2];
    buttons[1].onPress();
    await waitFor(() => expect(gmDeletes.some((d) => d.mock.calls.length > 0)).toBe(true));
  });

  it('members see no remove, no role taps, no rename row', async () => {
    group.group_members[0].role = 'member';
    await renderManage();

    expect(await screen.findByText('Aina')).toBeTruthy();
    expect(screen.queryByTestId('remove-u2')).toBeNull();
    expect(screen.queryByTestId('role-u2')).toBeNull();
    expect(screen.queryByTestId('edit-group')).toBeNull();
  });

  it('notify toggle goes through the RPC', async () => {
    await renderManage();

    const toggle = await screen.findByTestId('pref-notify');
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('set_group_notify', {
        p_group_id: 'g1',
        p_notify: false,
      })
    );
  });

  it('anyone-can-post writes to the group as admin', async () => {
    await renderManage();

    const toggle = await screen.findByTestId('pref-anyone-can-post');
    await fireEvent(toggle, 'valueChange', false);
    await waitFor(() =>
      expect(
        groupUpdates.some((u) =>
          u.mock.calls.some((call) => call[0]?.anyone_can_post === false)
        )
      ).toBe(true)
    );
  });

  it('leave confirms, calls the RPC and lands back on the tab', async () => {
    await renderManage();

    await fireEvent.press(await screen.findByTestId('leave-group'));
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)![2];
    buttons[1].onPress();

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('leave_group', { p_group_id: 'g1' })
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/(app)/(tabs)/groups'));
  });
});
