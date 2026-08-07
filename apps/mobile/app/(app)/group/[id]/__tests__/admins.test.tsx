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
    created_by: 'me',
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
      {
        user_id: 'u3',
        role: 'member',
        notify_new_plans: true,
        joined_at: '2026-01-03',
        profile: { display_name: 'Diego Morales', avatar_url: null },
      },
    ],
  };
});

describe('GroupAdminsScreen', () => {
  it('splits admins from candidates and credits the group creator', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    expect(await screen.findByText(/· you/)).toBeTruthy();
    expect(screen.getByText('Admins · 2')).toBeTruthy();
    expect(screen.getByText('Made the group')).toBeTruthy();
    expect(screen.getByText('Admin')).toBeTruthy();
    expect(
      screen.getByText('Admins edit the group, remove people, and make other admins.')
    ).toBeTruthy();
    // Diego is the one non-admin left, waiting under "Make someone an admin".
    expect(screen.getByTestId('promote-u3')).toBeTruthy();
    expect(screen.queryByTestId('promote-u2')).toBeNull();
    expect(screen.queryByTestId('demote-u3')).toBeNull();
  });

  it('promoting is one tap, no confirm', async () => {
    await renderAdmins();

    await fireEvent.press(await screen.findByTestId('promote-u2'));

    expect(screen.queryByTestId('confirm-demote')).toBeNull();
    await waitFor(() => expect(roleWrite()).not.toBeNull());
    expect(roleWrite()!.payload).toEqual({ role: 'admin' });
    expect(roleWrite()!.eqs).toContainEqual(['group_id', 'g1']);
    expect(roleWrite()!.eqs).toContainEqual(['user_id', 'u2']);
  });

  it('demoting another admin asks first, then writes member', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    await fireEvent.press(await screen.findByTestId('demote-u2'));

    expect(await screen.findByText('Remove Aina as admin?')).toBeTruthy();
    expect(roleWrite()).toBeNull();
    await fireEvent.press(screen.getByTestId('confirm-demote-confirm'));

    await waitFor(() => expect(roleWrite()).not.toBeNull());
    expect(roleWrite()!.payload).toEqual({ role: 'member' });
    expect(roleWrite()!.eqs).toContainEqual(['user_id', 'u2']);
  });

  it('cancelling the sheet writes nothing', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    await fireEvent.press(await screen.findByTestId('demote-u2'));
    await fireEvent.press(await screen.findByTestId('confirm-demote-cancel'));

    await waitFor(() => expect(screen.queryByText('Remove Aina as admin?')).toBeNull());
    expect(roleWrite()).toBeNull();
  });

  it('your own demotion is stepping down, while another admin exists', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    await fireEvent.press(await screen.findByTestId('demote-me'));

    expect(await screen.findByText('Step down as admin?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('confirm-demote-confirm'));

    await waitFor(() => expect(roleWrite()).not.toBeNull());
    expect(roleWrite()!.payload).toEqual({ role: 'member' });
    expect(roleWrite()!.eqs).toContainEqual(['user_id', 'me']);
  });

  // Never a disabled control: the only admin gets no minus at all, and the
  // note under the card carries the why. The way out is promoting someone
  // below.
  it('the only admin has no step-down control, and the note says why', async () => {
    await renderAdmins();

    const note = await screen.findByTestId('admins-note');
    expect(note).toHaveTextContent('A group needs at least one admin. Make someone else one first.');

    expect(screen.queryByTestId('demote-me')).toBeNull();
    expect(roleWrite()).toBeNull();

    expect(screen.getByTestId('promote-u2')).toBeTruthy();
  });

  it('with admins to spare, the note reassures instead', async () => {
    group.group_members[1].role = 'admin';
    await renderAdmins();

    const note = await screen.findByTestId('admins-note');
    expect(note).toHaveTextContent('They keep their place in the group either way.');
  });

  it('the search narrows candidates, and a miss says who is missing', async () => {
    await renderAdmins();

    await fireEvent.changeText(await screen.findByTestId('admin-search'), 'die');
    expect(screen.getByTestId('promote-u3')).toBeTruthy();
    expect(screen.queryByTestId('promote-u2')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('admin-search'), 'Zoe');
    expect(screen.getByTestId('candidates-empty')).toHaveTextContent(
      'Nobody called “Zoe” in this group.'
    );
  });

  // A non-admin can deep-link straight here; they get the admins card and
  // nothing else. RLS would refuse the write anyway, but no control invites it.
  it('a non-admin viewer gets a read-only list', async () => {
    group.group_members[0].role = 'member';
    group.group_members[1].role = 'admin';
    await renderAdmins();

    expect(await screen.findByText('Aina')).toBeTruthy();
    expect(screen.queryByTestId('demote-u2')).toBeNull();
    expect(screen.queryByTestId('promote-me')).toBeNull();
    expect(screen.queryByTestId('admin-search')).toBeNull();
    expect(screen.queryByTestId('admins-note')).toBeNull();
  });

  it('a failed write surfaces as an alert', async () => {
    await renderAdmins();

    const button = await screen.findByTestId('promote-u2');
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
