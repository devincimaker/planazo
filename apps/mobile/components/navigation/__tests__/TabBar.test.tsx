import { render, screen, fireEvent } from '@testing-library/react-native';
import { TabBar } from '../TabBar';

const mockPush = jest.fn();
let mockPendingCount = 0;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

    await fireEvent.press(screen.getByTestId('tab-create'));
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/create');
  });
});
