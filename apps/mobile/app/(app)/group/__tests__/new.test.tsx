import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewGroupScreen from '../new';
import { useAuthStore } from '../../../../stores/authStore';
import { supabase } from '../../../../lib/supabase';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string | undefined> = {};

jest.mock('../../../../lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
}));


const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

const ME = { id: 'me', display_name: 'Rocío', handle: 'rovidal', avatar_url: null };
const FRIENDSHIPS = [
  {
    requester_id: 'me',
    addressee_id: 'f1',
    requester: ME,
    addressee: { id: 'f1', display_name: 'Aina Roig', handle: 'ainaroig', avatar_url: null },
  },
  {
    requester_id: 'f2',
    addressee_id: 'me',
    requester: { id: 'f2', display_name: 'Marta Serra', handle: 'martaserra', avatar_url: null },
    addressee: ME,
  },
];

function primeSupabase() {
  mockFrom.mockImplementation(() => {
    const c: any = {};
    ['select', 'eq', 'or', 'single', 'insert'].forEach((m) => {
      c[m] = jest.fn(() => c);
    });
    c.then = (resolve: (v: unknown) => void) =>
      Promise.resolve({ data: FRIENDSHIPS, error: null }).then(resolve);
    return c;
  });
}

/** create_group returns the group row; invite_to_group returns a status. */
function primeRpc() {
  mockRpc.mockImplementation((fn: string) =>
    Promise.resolve(
      fn === 'create_group'
        ? { data: { id: 'g-new', name: 'Padel Dilluns' }, error: null }
        : { data: { status: 'invited' }, error: null }
    )
  );
}

async function renderNew() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <NewGroupScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  primeSupabase();
  primeRpc();
  useAuthStore.setState({
    user: { id: 'me' } as any,
    profile: ME as any,
  });
});

describe('NewGroupScreen', () => {
  it('demands a name before anything else', async () => {
    await renderNew();

    expect(await screen.findByText('Name it first')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('name-input'), 'Padel Dilluns');
    expect(screen.getByText('Create group')).toBeTruthy();
  });

  it('lists friends from both friendship directions', async () => {
    await renderNew();

    expect(await screen.findByText('Aina Roig')).toBeTruthy();
    expect(screen.getByText('@ainaroig')).toBeTruthy();
    expect(screen.getByText('Marta Serra')).toBeTruthy();
  });

  it('picking people turns the CTA into create-and-invite and sends the invites', async () => {
    await renderNew();

    await fireEvent.changeText(screen.getByTestId('name-input'), 'Padel Dilluns');
    await fireEvent.press(await screen.findByTestId('person-f1'));
    await fireEvent.press(screen.getByTestId('person-f2'));

    expect(screen.getByText('2 selected')).toBeTruthy();
    await fireEvent.press(screen.getByText('Create and invite 2'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    // PLA-35: one server-side call replaces the group + membership inserts,
    // and the client no longer names itself as creator or picks the role.
    expect(mockRpc).toHaveBeenCalledWith(
      'create_group',
      expect.objectContaining({ p_name: 'Padel Dilluns' })
    );
    expect(mockFrom).not.toHaveBeenCalledWith('group_members');
    expect(mockRpc).toHaveBeenCalledWith('invite_to_group', {
      p_group_id: 'g-new',
      p_invitee: 'f1',
    });
    expect(mockRpc).toHaveBeenCalledWith('invite_to_group', {
      p_group_id: 'g-new',
      p_invitee: 'f2',
    });
  });

  it('deselecting via the chip drops the pick', async () => {
    await renderNew();

    await fireEvent.press(await screen.findByTestId('person-f1'));
    expect(screen.getByText('1 selected')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('chip-f1'));
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('stores the picked swatch on create', async () => {
    await renderNew();

    await fireEvent.changeText(screen.getByTestId('name-input'), 'Cine');
    await fireEvent.press(screen.getByTestId('swatch-2'));
    await fireEvent.press(screen.getByText('Create group'));

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockRpc).toHaveBeenCalledWith(
      'create_group',
      expect.objectContaining({ p_color: '#F6C453' })
    );
  });
});
