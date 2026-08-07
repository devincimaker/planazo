import { Alert } from 'react-native';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ManageGroupScreen from '../manage';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

const mockNavigate = jest.fn();
const mockPush = jest.fn();
const mockShowToast = jest.fn();

// Only the toast is faked: SwipeRow and ConfirmSheet are the change under
// test, so they stay real. The host lives at the app layout, above this screen.
jest.mock('../../../../../components/ui', () => ({
  ...jest.requireActual('../../../../../components/ui'),
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), navigate: mockNavigate }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));


const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let group: any;
let groupUpdates: jest.Mock[] = [];
let gmUpdates: jest.Mock[] = [];
let gmDeletes: jest.Mock[] = [];
let blockUpserts: jest.Mock[] = [];
let blockDeletes: jest.Mock[] = [];
let blockedRows: { blocked_id: string }[] = [];

function primeSupabase() {
  groupUpdates = [];
  gmUpdates = [];
  gmDeletes = [];
  blockUpserts = [];
  blockDeletes = [];
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    let mutation = false;
    ['select', 'eq', 'single', 'order'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.update = jest.fn(() => {
      mutation = true;
      return c;
    });
    c.upsert = jest.fn(() => {
      mutation = true;
      return c;
    });

    c.delete = jest.fn(() => {
      mutation = true;
      return c;
    });
    if (table === 'groups') groupUpdates.push(c.update);
    if (table === 'blocked_users') {
      blockUpserts.push(c.upsert);
      blockDeletes.push(c.delete);
    }
    if (table === 'group_members') {
      gmUpdates.push(c.update);
      gmDeletes.push(c.delete);
    }
    c.then = (resolve: (v: unknown) => void) => {
      const result = mutation
        ? { error: null }
        : { data: table === 'blocked_users' ? blockedRows : group, error: null };
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
  blockedRows = [];
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
  it('admin sees themselves first, badged', async () => {
    await renderManage();

    expect(await screen.findByText(/· you/)).toBeTruthy();
    expect(screen.getByText('Aina')).toBeTruthy();
    expect(screen.getByTestId('admin-me')).toBeTruthy();
  });

  // The badge says who runs the group. It is not a control, and no tap on
  // this screen changes somebody's role — a status pill was never going to be
  // discovered as the way to do it. Role changes live on the Admins screen,
  // behind the "Admins" row in "How it runs" (PLA-50).
  it('the admin badge marks admins only, and nothing on it is pressable', async () => {
    group.group_members[1].role = 'admin';
    await renderManage();

    await screen.findByText('Aina');
    expect(screen.getByTestId('admin-u2')).toBeTruthy();
    expect(screen.queryByText('Member')).toBeNull();
    expect(screen.queryByTestId('role-u2')).toBeNull();

    group.group_members[1].role = 'member';
  });

  it('plain members carry no badge at all', async () => {
    await renderManage();

    await screen.findByText('Aina');
    expect(screen.queryByTestId('admin-u2')).toBeNull();
    expect(screen.queryByText('Member')).toBeNull();
  });

  /**
   * Invoke a row's accessibility action the way VoiceOver does.
   *
   * The two destructive actions live behind a swipe now, so they are hidden
   * from assistive tech until the row is open, and reachable the whole time
   * through the row's own `accessibilityActions`. That is the path this drives.
   *
   * Deliberately not `fireEvent`: RNTL gates every event through
   * `isEventEnabled`, which asks the nearest touch responder whether it would
   * claim a gesture right now (`fire-event.js:34`). A closed SwipeRow answers
   * no — that is the whole point of it, so vertical scrolling works — and RNTL
   * then blocks *all* events on it, accessibility included. iOS calls
   * `onAccessibilityAction` directly and never consults the responder system.
   */
  async function invoke(userId: string, action: 'remove' | 'block') {
    const row = await screen.findByTestId(`person-${userId}-row`);
    await act(async () => {
      row.props.onAccessibilityAction({ nativeEvent: { actionName: action } });
    });
  }

  it('the swipe actions stay out of the accessibility tree until the row opens', async () => {
    await renderManage();

    await screen.findByTestId('person-u2-row');
    expect(screen.queryByTestId('remove-u2')).toBeNull();
    expect(screen.queryByTestId('block-u2')).toBeNull();

    // The row still offers both, by name, to anyone driving by rotor.
    const row = screen.getByTestId('person-u2-row');
    expect(row.props.accessibilityActions).toEqual([
      { name: 'block', label: 'Block' },
      { name: 'remove', label: 'Remove' },
    ]);
  });

  // Guideline 1.2: blocking is a personal choice, so it is available to every
  // member — not only admins, who are the only ones who can remove anybody.
  it('blocking a member asks first, then records it', async () => {
    await renderManage();

    await invoke('u2', 'block');
    expect(screen.getByText('Block Aina?')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('member-confirm-confirm'));

    await waitFor(() =>
      expect(
        blockUpserts.some((u) =>
          u.mock.calls.some((call) => call[0]?.blocked_id === 'u2' && call[0]?.blocker_id === 'me')
        )
      ).toBe(true)
    );
  });

  it('backing out of the block confirmation records nothing', async () => {
    await renderManage();

    await invoke('u2', 'block');
    await fireEvent.press(screen.getByTestId('member-confirm-cancel'));

    expect(screen.queryByText('Block Aina?')).toBeNull();
    expect(blockUpserts.every((u) => u.mock.calls.length === 0)).toBe(true);
  });

  // Undo must not ask again — you already decided once, and the second dialog
  // would be asking permission to be less strict.
  it('an already-blocked member unblocks with no confirmation', async () => {
    blockedRows = [{ blocked_id: 'u2' }];
    await renderManage();

    const row = await screen.findByTestId('person-u2-row');
    expect(within(row).getByText('Blocked')).toBeTruthy();
    expect(row.props.accessibilityActions).toContainEqual({ name: 'block', label: 'Unblock' });

    await invoke('u2', 'block');
    expect(screen.queryByText(/^Block /)).toBeNull();
    await waitFor(() => expect(blockDeletes.some((d) => d.mock.calls.length > 0)).toBe(true));
  });

  it('report this group opens the report screen for the group', async () => {
    await renderManage();

    await fireEvent.press(await screen.findByTestId('report-group'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(app)/report',
      params: { type: 'group', id: 'g1', subject: 'Piso Gràcia' },
    });
  });

  it('remove asks first, then takes the person off the list before the delete', async () => {
    await renderManage();

    await invoke('u2', 'remove');
    expect(screen.getByText('Remove Aina?')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('member-confirm-confirm'));

    // The row goes at once, and the toast offers the way back.
    await waitFor(() => expect(screen.queryByText('Aina')).toBeNull());
    expect(mockShowToast.mock.calls.at(-1)![0]).toBe('Aina is out of the group');
    expect(mockShowToast.mock.calls.at(-1)![1].action.label).toBe('Undo');
    // Nothing has been deleted yet: that is what makes the undo honest.
    expect(gmDeletes.every((d) => d.mock.calls.length === 0)).toBe(true);
  });

  it('undo inside the window means the membership is never deleted', async () => {
    const view = await renderManage();

    await invoke('u2', 'remove');
    await fireEvent.press(screen.getByTestId('member-confirm-confirm'));
    await waitFor(() => expect(screen.queryByText('Aina')).toBeNull());

    await act(async () => {
      mockShowToast.mock.calls.at(-1)![1].action.onPress();
    });

    expect(await screen.findByText('Aina')).toBeTruthy();
    // Leaving the screen commits whatever is still pending, so an unmount here
    // is the strongest way to say "nothing was pending".
    view.unmount();
    expect(gmDeletes.every((d) => d.mock.calls.length === 0)).toBe(true);
  });

  it('the delete lands when the undo window closes', async () => {
    jest.useFakeTimers();
    try {
      await renderManage();

      await invoke('u2', 'remove');
      await fireEvent.press(screen.getByTestId('member-confirm-confirm'));
      await waitFor(() => expect(screen.queryByText('Aina')).toBeNull());

      await act(async () => {
        jest.advanceTimersByTime(5000);
      });

      await waitFor(() => expect(gmDeletes.some((d) => d.mock.calls.length > 0)).toBe(true));
    } finally {
      jest.useRealTimers();
    }
  });

  // A pending removal that vanished with the screen would leave the person
  // gone from the list and still in the group, with nothing left to say so.
  it('leaving the screen commits a pending removal immediately', async () => {
    const view = await renderManage();

    await invoke('u2', 'remove');
    await fireEvent.press(screen.getByTestId('member-confirm-confirm'));
    await waitFor(() => expect(screen.queryByText('Aina')).toBeNull());
    expect(gmDeletes.every((d) => d.mock.calls.length === 0)).toBe(true);

    view.unmount();

    await waitFor(() => expect(gmDeletes.some((d) => d.mock.calls.length > 0)).toBe(true));
  });

  it('members can block but not remove, and get no rename or admins row', async () => {
    group.group_members[0].role = 'member';
    await renderManage();

    expect(await screen.findByText('Aina')).toBeTruthy();
    expect(screen.getByTestId('person-u2-row').props.accessibilityActions).toEqual([
      { name: 'block', label: 'Block' },
    ]);
    expect(screen.queryByTestId('edit-group')).toBeNull();
    expect(screen.queryByTestId('manage-admins')).toBeNull();
  });

  it('the admins row opens the Admins screen', async () => {
    await renderManage();

    await fireEvent.press(await screen.findByTestId('manage-admins'));

    expect(mockPush).toHaveBeenCalledWith('/(app)/group/g1/admins');
  });

  // The swipe hint must only promise what the swipe will actually offer:
  // non-admins get no Remove action.
  it('the swipe hint matches what the viewer can do', async () => {
    await renderManage();
    expect(await screen.findByText('Swipe a name for remove and block')).toBeTruthy();
  });

  it('a non-admin viewer gets the block-only hint', async () => {
    group.group_members[0].role = 'member';
    await renderManage();
    expect(await screen.findByText('Swipe a name to block')).toBeTruthy();
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
