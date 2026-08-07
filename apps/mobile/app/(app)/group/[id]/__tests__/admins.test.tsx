import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupAdminsScreen from '../admins';
import { useAuthStore } from '../../../../../stores/authStore';
import { supabase } from '../../../../../lib/supabase';

jest.mock('../../../../../lib/supabase', () => ({
  supabase: { from: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({ id: 'g1' }),
}));

const mockFrom = supabase.from as jest.Mock;

let group: any;
let gmUpdates: { update: jest.Mock; eq: jest.Mock }[] = [];

function primeSupabase() {
  gmUpdates = [];
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
    if (table === 'group_members') gmUpdates.push({ update: c.update, eq: c.eq });
    c.then = (resolve: (v: unknown) => void) => {
      const result = mutation ? { error: null } : { data: group, error: null };
      return Promise.resolve(result).then(resolve);
    };
    return c;
  });
}

async function renderAdmins() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupAdminsScreen />
    </QueryClientProvider>
  );
}

/** The one group_members update that ran, or null. */
function roleWrite() {
  const hit = gmUpdates.find((c) => c.update.mock.calls.length > 0);
  if (!hit) return null;
  return {
    payload: hit.update.mock.calls[0][0],
    eqs: hit.eq.mock.calls,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert');
  primeSupabase();
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

describe('GroupAdminsScreen', () => {
  it('lists everyone, badges admins, and says what admin means', async () => {
    await renderAdmins();

    expect(await screen.findByText(/· you/)).toBeTruthy();
    expect(screen.getByText('Aina')).toBeTruthy();
    expect(screen.getByTestId('admin-me')).toBeTruthy();
    expect(screen.queryByTestId('admin-u2')).toBeNull();
    expect(screen.getByText('Admins can remove people and edit the group.')).toBeTruthy();
  });

  it('promoting a member writes admin onto their membership', async () => {
    await renderAdmins();

    const button = await screen.findByTestId('role-action-u2');
    expect(screen.getByText('Make admin')).toBeTruthy();
    await fireEvent.press(button);

    await waitFor(() => expect(roleWrite()).not.toBeNull());
    expect(roleWrite()!.payload).toEqual({ role: 'admin' });
    expect(roleWrite()!.eqs).toContainEqual(['group_id', 'g1']);
    expect(roleWrite()!.eqs).toContainEqual(['user_id', 'u2']);
  });

  it('demoting another admin writes member, labelled as removal', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    const button = await screen.findByTestId('role-action-u2');
    expect(screen.getByText('Remove as admin')).toBeTruthy();
    await fireEvent.press(button);

    await waitFor(() => expect(roleWrite()).not.toBeNull());
    expect(roleWrite()!.payload).toEqual({ role: 'member' });
    expect(roleWrite()!.eqs).toContainEqual(['user_id', 'u2']);
  });

  it('your own demotion is stepping down, while another admin exists', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    const button = await screen.findByTestId('role-action-me');
    expect(screen.getByText('Step down as admin')).toBeTruthy();
    await fireEvent.press(button);

    await waitFor(() => expect(roleWrite()).not.toBeNull());
    expect(roleWrite()!.payload).toEqual({ role: 'member' });
    expect(roleWrite()!.eqs).toContainEqual(['user_id', 'me']);
  });

  // Never a disabled button: the copy explains, and the action is simply
  // absent until someone else is admin.
  it('the only admin gets the note instead of a way to step down', async () => {
    await renderAdmins();

    expect(await screen.findByTestId('last-admin-note')).toBeTruthy();
    expect(screen.queryByTestId('role-action-me')).toBeNull();
    // The member next to them is still promotable — that is the way out.
    expect(screen.getByTestId('role-action-u2')).toBeTruthy();
  });

  // A non-admin can deep-link straight here; they get the list and nothing
  // else. RLS would refuse the write anyway, but no button ever invites it.
  it('a non-admin viewer gets a read-only list', async () => {
    group.group_members[0].role = 'member';
    group.group_members[1].role = 'admin';
    await renderAdmins();

    expect(await screen.findByText('Aina')).toBeTruthy();
    expect(screen.getByTestId('admin-u2')).toBeTruthy();
    expect(screen.queryByTestId('role-action-me')).toBeNull();
    expect(screen.queryByTestId('role-action-u2')).toBeNull();
    expect(screen.queryByTestId('last-admin-note')).toBeNull();
  });

  it('a failed write surfaces as an alert', async () => {
    await renderAdmins();

    const button = await screen.findByTestId('role-action-u2');
    mockFrom.mockImplementation(() => {
      const c: any = {};
      ['update', 'eq'].forEach((m) => {
        c[m] = jest.fn(() => c);
      });
      c.then = (resolve: (v: unknown) => void) =>
        Promise.resolve({ error: new Error('nope') }).then(resolve);
      return c;
    });
    await fireEvent.press(button);

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Error', 'nope'));
  });
});
