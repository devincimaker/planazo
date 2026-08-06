import { StyleSheet } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { TabBar } from '../TabBar';

const mockPush = jest.fn();
let mockPendingCount = 0;
let mockGroups = { groups: [], hasGroups: true, loading: false };

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../../lib/useMyGroups', () => ({
  useMyGroups: () => mockGroups,
}));

jest.mock('../../../lib/usePendingInvites', () => ({
  usePendingInvites: () => ({
    count: mockPendingCount,
    groupInvites: [],
    friendRequests: [],
  }),
}));

function makeProps(activeIndex = 0) {
  return {
    state: {
      index: activeIndex,
      routes: [
        { key: 'index-key', name: 'index' },
        { key: 'groups-key', name: 'groups' },
      ],
    },
    navigation: {
      navigate: jest.fn(),
      emit: jest.fn(() => ({ defaultPrevented: false })),
    },
  };
}

describe('TabBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingCount = 0;
    mockGroups = { groups: [], hasGroups: true, loading: false };
  });

  it('renders both tabs and the create button', async () => {
    await render(<TabBar {...makeProps()} />);

    expect(screen.getByText('Plans')).toBeTruthy();
    expect(screen.getByText('Groups')).toBeTruthy();
    expect(screen.getByTestId('tab-create')).toBeTruthy();
    expect(screen.queryByTestId('groups-tab-badge')).toBeNull();
  });

  it('shows the pending-invites badge on the Groups tab', async () => {
    mockPendingCount = 3;
    await render(<TabBar {...makeProps()} />);

    expect(screen.getByTestId('groups-tab-badge')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('navigates to the inactive tab on press', async () => {
    const props = makeProps(0);
    await render(<TabBar {...props} />);

    await fireEvent.press(screen.getByTestId('tab-groups'));
    expect(props.navigation.navigate).toHaveBeenCalledWith('groups');

    // Pressing the already-active tab does not re-navigate
    await fireEvent.press(screen.getByTestId('tab-index'));
    expect(props.navigation.navigate).not.toHaveBeenCalledWith('index');
  });

  it('opens the create sheet from the + button', async () => {
    await render(<TabBar {...makeProps()} />);

    expect(screen.getByLabelText('New plan')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('tab-create'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/create');
  });

  // PLA-68: still a sheet about making a plan, just the one that can be acted
  // on. A short detent has to be declared before the screen mounts, which is
  // why the choice lives here and not inside the create screen.
  it('opens the needs-a-group sheet while the user is in no groups', async () => {
    mockGroups = { groups: [], hasGroups: false, loading: false };
    await render(<TabBar {...makeProps()} />);

    await fireEvent.press(screen.getByTestId('tab-create'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/needs-group');
  });

  // "No groups" is also what an unanswered query looks like. Guessing would
  // send someone who has groups to the wrong sheet for as long as it takes.
  it('falls back to the create sheet while the groups query is in flight', async () => {
    mockGroups = { groups: [], hasGroups: false, loading: true };
    await render(<TabBar {...makeProps()} />);

    await fireEvent.press(screen.getByTestId('tab-create'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/create');
  });

  // PLA-40: the tabs cleared 44 on their icon and label alone, which made the
  // floor a coincidence of the type scale rather than a promise. Now it is
  // declared, so shrinking either one cannot quietly take the tab under it.
  it('keeps every tab at the 44pt minimum', async () => {
    await render(<TabBar {...makeProps()} />);

    for (const id of ['tab-index', 'tab-groups']) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });
});
