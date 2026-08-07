import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JoinByInviteScreen from '../[code]';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';
import { takePendingJoin } from '../../../../lib/pendingJoin';

const mockReplace = jest.fn();
// `mock`-prefixed so jest.mock's factory is allowed to close over it.
let mockParams: { code?: string } = { code: 'ABCD2345' };

jest.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const mockRpc = supabase.rpc as jest.Mock;

/** Both RPCs land on the same mock, so route by name rather than call order. */
function primeRpc({
  preview,
  join,
}: {
  preview?: { data: unknown; error: unknown };
  join?: { data: unknown; error: unknown };
}) {
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'get_group_by_invite_code'
        ? (preview ?? { data: [{ id: 'g1', name: 'Piso Gràcia', join_mode: 'open' }], error: null })
        : (join ?? { data: { status: 'joined', group_id: 'g1' }, error: null })
    )
  );
}

async function renderJoin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <JoinByInviteScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  takePendingJoin();
  mockParams = { code: 'ABCD2345' };
  primeRpc({});
  useAuthStore.setState({ user: { id: 'me' } as any, session: { user: { id: 'me' } } as any });
});

describe('JoinByInviteScreen', () => {
  it('names the group before joining anyone to it', async () => {
    await renderJoin();

    expect(await screen.findByTestId('join-preview')).toBeTruthy();
    expect(screen.getByText('Piso Gràcia')).toBeTruthy();
    expect(screen.getByText('Join Piso Gràcia')).toBeTruthy();
    // Preview only. Nothing has been written until the button is pressed.
    expect(mockRpc).not.toHaveBeenCalledWith('join_group_by_invite_code', expect.anything());
  });

  it('joins on the button and lands in the group', async () => {
    await renderJoin();
    await fireEvent.press(await screen.findByTestId('join-group'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/group/g1'));
    expect(mockRpc).toHaveBeenCalledWith('join_group_by_invite_code', { p_code: 'ABCD2345' });
  });

  /**
   * Being told you were already in a group you just asked to join is a
   * correction nobody needs. Same destination as a fresh join.
   */
  it('takes an existing member to the group rather than correcting them', async () => {
    primeRpc({ join: { data: { status: 'already_member', group_id: 'g1' }, error: null } });

    await renderJoin();
    await fireEvent.press(await screen.findByTestId('join-group'));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)/group/g1'));
    expect(screen.queryByTestId('join-failed')).toBeNull();
  });

  /**
   * PLA-49. The button says what the tap will do before it does it: an
   * approval door is asked, not entered, and the screen after it says so.
   */
  it('an approval door asks rather than joins', async () => {
    primeRpc({
      preview: { data: [{ id: 'g1', name: 'Club Pàdel', join_mode: 'approval' }], error: null },
      join: { data: { status: 'requested', group_id: 'g1', name: 'Club Pàdel' }, error: null },
    });

    await renderJoin();

    expect(await screen.findByText('Ask to join Club Pàdel')).toBeTruthy();
    expect(
      screen.getByText('An admin has to let you in. They get your request the moment you send it.')
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId('join-group'));

    expect(await screen.findByTestId('join-requested')).toBeTruthy();
    expect(screen.getByText('You’ve asked to join')).toBeTruthy();
    // Nowhere to go yet: the group is not theirs until an admin says so.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * A decline is never announced, so asking again after one looks exactly like
   * asking for the first time. The server returns the same `requested` either
   * way, and this screen must not go looking for a difference.
   */
  it('a second ask after a silent decline looks like the first', async () => {
    primeRpc({
      preview: { data: [{ id: 'g1', name: 'Club Pàdel', join_mode: 'approval' }], error: null },
      join: { data: { status: 'requested', group_id: 'g1', name: 'Club Pàdel' }, error: null },
    });

    await renderJoin();
    await fireEvent.press(await screen.findByTestId('join-group'));

    expect(await screen.findByTestId('join-requested')).toBeTruthy();
    expect(screen.queryByText(/declin/i)).toBeNull();
  });

  it('says so when the code resolves to nothing', async () => {
    primeRpc({ preview: { data: [], error: null } });

    await renderJoin();

    expect(await screen.findByTestId('join-not-found')).toBeTruthy();
    expect(screen.queryByTestId('join-group')).toBeNull();
  });

  /**
   * The database owns what a real code is, so a segment that does not look
   * like one still goes to the server rather than being judged here. A second
   * copy of the rule in the client could only ever disagree with it, and the
   * seeded demo codes are exactly where it would.
   */
  it('lets the server rule on a segment that does not look like a code', async () => {
    mockParams = { code: 'weekend' };
    primeRpc({ preview: { data: [], error: null } });

    await renderJoin();

    expect(await screen.findByTestId('join-not-found')).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith('get_group_by_invite_code', { code: 'WEEKEND' });
  });

  it('asks nothing when the link stops at /join', async () => {
    mockParams = {};

    await renderJoin();

    expect(await screen.findByTestId('join-not-found')).toBeTruthy();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('offers a retry when the lookup fails rather than blaming the link', async () => {
    primeRpc({ preview: { data: null, error: { message: 'network' } } });

    await renderJoin();

    expect(await screen.findByTestId('join-error')).toBeTruthy();
  });

  it('keeps the failed join on screen so it can be tried again', async () => {
    primeRpc({ join: { data: null, error: { message: 'network' } } });

    await renderJoin();
    await fireEvent.press(await screen.findByTestId('join-group'));

    expect(await screen.findByTestId('join-failed')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId('join-group')).toBeTruthy();
  });

  /**
   * The whole point of PLA-77: an invite is how most people meet Planazo, so
   * arriving without an account is the ordinary path, not an error. The code
   * has to survive the trip through signup.
   */
  it('sends someone with no account to sign up, holding the code', async () => {
    useAuthStore.setState({ user: null, session: null });

    await renderJoin();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/signup'));
    expect(takePendingJoin()).toBe('ABCD2345');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('still offers signup when the link carries no code at all', async () => {
    useAuthStore.setState({ user: null, session: null });
    mockParams = {};

    await renderJoin();

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(auth)/signup'));
    expect(takePendingJoin()).toBeNull();
  });
});
