import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import InviteToGroupSheet from '../invite';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

const mockBack = jest.fn();

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: mockBack, navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));


jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
}));

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

let group: any;
let pendingInvites: any[] = [];
let acceptedFriendships: any[] = [];
/** What get_group_invite_code answers with. Null plus a message is a refusal. */
let inviteCode: { data: string | null; error: { message: string } | null };

function primeSupabase() {
  mockFrom.mockImplementation((table: string) => {
    const c: any = {};
    let single = false;
    ['select', 'eq', 'or', 'order', 'in'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.single = jest.fn(() => {
      single = true;
      return c;
    });
    c.then = (resolve: (v: unknown) => void) => {
      const result =
        table === 'groups' && single
          ? { data: group, error: null }
          : table === 'group_invites'
            ? { data: pendingInvites, error: null }
            : table === 'friendships'
              ? { data: acceptedFriendships, error: null }
              : { data: [], error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderInvite() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <InviteToGroupSheet />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');
  primeSupabase();
  inviteCode = { data: 'ABCD2345', error: null };
  // The code is no longer a column the client may read (PLA-49), so the sheet
  // asks for it by name and every other RPC keeps the old default.
  mockRpc.mockImplementation(async (fn: string) =>
    fn === 'get_group_invite_code' ? inviteCode : { data: { status: 'invited' }, error: null }
  );
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: { id: 'me', display_name: 'Rocío', avatar_url: null } as any,
  });
  group = {
    id: 'g1',
    name: 'Piso Gràcia',
    join_mode: 'open',
    group_members: [
      { user_id: 'me', role: 'admin' },
      { user_id: 'f1', role: 'member' },
    ],
  };
  pendingInvites = [{ invitee_id: 'f2' }];
  acceptedFriendships = [
    {
      requester_id: 'me',
      addressee_id: 'f1',
      requester: { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null },
      addressee: { id: 'f1', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
    },
    {
      requester_id: 'f2',
      addressee_id: 'me',
      requester: { id: 'f2', display_name: 'Marta Serra', handle: 'martaserra', avatar_url: null },
      addressee: { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null },
    },
    {
      requester_id: 'me',
      addressee_id: 'f3',
      requester: { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null },
      addressee: { id: 'f3', display_name: 'Pau Miró', handle: 'paumiro', avatar_url: null },
    },
  ];
});

describe('InviteToGroupSheet', () => {
  // PLA-77: an https link, because `planazo://` was never tappable in the
  // messengers people actually paste it into.
  it('shows the join link and copies it', async () => {
    await renderInvite();

    expect(await screen.findByText('https://planazo.me/join/ABCD2345')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('copy-link'));
    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('https://planazo.me/join/ABCD2345')
    );
    expect(await screen.findByText('Link copied ✓')).toBeTruthy();
  });

  it('asks for the code by RPC rather than reading the column', async () => {
    await renderInvite();

    await screen.findByText('https://planazo.me/join/ABCD2345');
    expect(mockRpc).toHaveBeenCalledWith('get_group_invite_code', { p_group_id: 'g1' });
    // The select that used to carry invite_code no longer does.
    const selects = mockFrom.mock.results
      .map((r) => (r.value as any).select.mock.calls[0]?.[0])
      .filter(Boolean);
    expect(selects.some((s: string) => s.includes('invite_code'))).toBe(false);
  });

  // The sheet promises what the link actually does. A door on approval that
  // still said "joins straight away" is the whole issue in miniature.
  it('an open door says the link lets people straight in', async () => {
    await renderInvite();
    expect(await screen.findByText('Anyone with the link joins straight away.')).toBeTruthy();
  });

  it('an approval door says the link only asks', async () => {
    group.join_mode = 'approval';
    await renderInvite();
    expect(
      await screen.findByText('People with the link ask to join, and an admin lets them in.')
    ).toBeTruthy();
  });

  it('an admin can reset the link, after being told what that costs', async () => {
    await renderInvite();

    await fireEvent.press(await screen.findByTestId('reset-link'));
    const [title, body, buttons] = (Alert.alert as jest.Mock).mock.calls.at(-1)!;
    expect(title).toBe('Reset the invite link?');
    expect(body).toMatch(/old link stops working/);

    buttons[1].onPress();
    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('rotate_invite_code', { p_group_id: 'g1' })
    );
  });

  it('a member gets no reset row, and backing out resets nothing', async () => {
    group.group_members[0].role = 'member';
    await renderInvite();

    await screen.findByTestId('copy-link');
    expect(screen.queryByTestId('reset-link')).toBeNull();
    expect(mockRpc).not.toHaveBeenCalledWith('rotate_invite_code', expect.anything());
  });

  // Refused by the admins dial: the friend picker is still worth showing, so
  // only the link goes, and it says why.
  it('a refused code leaves the rest of the sheet standing', async () => {
    inviteCode = { data: null, error: { message: 'Only admins can invite to this group' } };
    await renderInvite();

    expect(await screen.findByTestId('link-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('copy-link')).toBeNull();
    expect(screen.getByTestId('invitee-f3')).toBeTruthy();
  });

  it('members are excluded, already-invited people are disabled', async () => {
    await renderInvite();

    // f1 is already a member: no chip at all
    await screen.findByTestId('invitee-f2');
    expect(screen.queryByTestId('invitee-f1')).toBeNull();
    // f2 has a pending invite: visible but marked
    expect(screen.getByText('invited')).toBeTruthy();
    // f3 is pickable
    expect(screen.getByTestId('invitee-f3')).toBeTruthy();
  });

  it('picking people sends invites through the RPC', async () => {
    await renderInvite();

    expect(await screen.findByText('Share the link instead')).toBeTruthy();

    await fireEvent.press(await screen.findByTestId('invitee-f3'));
    await fireEvent.press(screen.getByText('Send 1 invite'));

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('invite_to_group', {
        p_group_id: 'g1',
        p_invitee: 'f3',
      })
    );
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });
});
