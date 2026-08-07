import { act, renderHook } from '@testing-library/react-native';
import { DISMISS_MS, useDismissTo, useLeaveFor } from '../navigation';

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
/** False on a cold deep link: the screen mounts with nothing behind it. */
let mockCanGoBack = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: mockNavigate,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockCanGoBack = true;
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * The two branches are what the screens above this can only prove one at a
 * time, so they are pinned here once rather than re-argued in every suite that
 * happens to own a sheet.
 */
describe('useLeaveFor', () => {
  it('pops, then arrives once the dismissal animation has had its time', async () => {
    const { result } = await renderHook(() => useLeaveFor());

    await act(async () => result.current('/(app)/plan/p1'));
    expect(mockBack).toHaveBeenCalled();
    // Not yet: pushing into a sheet still on screen lands behind it.
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(DISMISS_MS);
    });
    expect(mockPush).toHaveBeenCalledWith('/(app)/plan/p1');
  });

  it('replaces instead when there is nothing to pop, and arms no timer', async () => {
    mockCanGoBack = false;
    const { result } = await renderHook(() => useLeaveFor());

    await act(async () => result.current('/(app)/plan/p1'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)/plan/p1');
    expect(mockBack).not.toHaveBeenCalled();

    // A replace has already arrived. A deferred push on top of it would be a
    // second copy of the same screen.
    await act(async () => {
      jest.advanceTimersByTime(DISMISS_MS * 10);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("navigates rather than pushes when told to, so a tab can't stack twice", async () => {
    const { result } = await renderHook(() => useLeaveFor('navigate'));

    await act(async () => result.current('/(app)/(tabs)/groups'));
    await act(async () => {
      jest.advanceTimersByTime(DISMISS_MS);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/(app)/(tabs)/groups');
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('useDismissTo', () => {
  it('pops and reports that it did, so a caller can time what follows', async () => {
    const { result } = await renderHook(() => useDismissTo('/(app)/(tabs)'));

    let popped!: boolean;
    await act(async () => {
      popped = result.current();
    });
    expect(popped).toBe(true);
    expect(mockBack).toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('replaces with the fallback and reports that nothing was popped', async () => {
    mockCanGoBack = false;
    const { result } = await renderHook(() => useDismissTo('/(app)/(tabs)'));

    let popped!: boolean;
    await act(async () => {
      popped = result.current();
    });
    expect(popped).toBe(false);
    expect(mockReplace).toHaveBeenCalledWith('/(app)/(tabs)');
    expect(mockBack).not.toHaveBeenCalled();
  });
});
