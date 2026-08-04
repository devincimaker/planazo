import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { usePendingRemoval, UNDO_WINDOW_MS } from '../usePendingRemoval';

const mockShowToast = jest.fn();

// The toast is where the undo lives, so it is the hook's only output besides
// the pending id. Everything else about it belongs to the host at the layout.
jest.mock('../../components/ui', () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

/** The Undo handler the hook handed to the toast, from its last call. */
const undoFromToast = () =>
  mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1][1].action.onPress as () => void;

describe('usePendingRemoval', () => {
  let appStateHandler: ((state: string) => void) | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
    mockShowToast.mockClear();
    appStateHandler = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type: string, handler: any) => {
      appStateHandler = handler;
      return { remove: jest.fn() } as any;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('hides the row at once and holds the delete for the undo window', async () => {
    const remove = jest.fn();
    const { result } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => result.current.startRemoval('u1', 'Lucia'));
    expect(result.current.pendingRemovalId).toBe('u1');
    expect(remove).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      'Lucia is out of the group',
      expect.objectContaining({ durationMs: UNDO_WINDOW_MS })
    );

    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });
    expect(remove).toHaveBeenCalledWith('u1');
  });

  it('undo cancels a delete that never ran, and the row comes back', async () => {
    const remove = jest.fn();
    const { result } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => result.current.startRemoval('u1', 'Lucia'));
    await act(async () => undoFromToast()());

    expect(result.current.pendingRemovalId).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS * 2);
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('a second removal commits the first rather than queueing behind it', async () => {
    const remove = jest.fn();
    const { result } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => result.current.startRemoval('u1', 'Lucia'));
    await act(async () => result.current.startRemoval('u2', 'Alex'));

    // Two undos with one toast is one undo nobody can aim, so the first
    // removal is already final by the time the second toast is up.
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('u1');
    expect(result.current.pendingRemovalId).toBe('u2');

    // And undoing now only ever undoes the second.
    await act(async () => undoFromToast()());
    await act(async () => {
      jest.advanceTimersByTime(UNDO_WINDOW_MS);
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('backgrounding the app closes the window early and lands the removal', async () => {
    const remove = jest.fn();
    const { result } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => result.current.startRemoval('u1', 'Lucia'));
    await act(async () => appStateHandler?.('background'));

    expect(remove).toHaveBeenCalledWith('u1');
    expect(result.current.pendingRemovalId).toBeNull();
  });

  it('staying active leaves the window open', async () => {
    const remove = jest.fn();
    const { result } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => result.current.startRemoval('u1', 'Lucia'));
    await act(async () => appStateHandler?.('active'));

    expect(remove).not.toHaveBeenCalled();
    expect(result.current.pendingRemovalId).toBe('u1');
  });

  it('leaving the screen lands the removal rather than losing it', async () => {
    const remove = jest.fn();
    const { result, unmount } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => result.current.startRemoval('u1', 'Lucia'));
    await act(async () => unmount());

    expect(remove).toHaveBeenCalledWith('u1');
  });

  it('unmounting with nothing pending deletes nobody', async () => {
    const remove = jest.fn();
    const { unmount } = await renderHook(() => usePendingRemoval(remove));

    await act(async () => unmount());
    expect(remove).not.toHaveBeenCalled();
  });
});
