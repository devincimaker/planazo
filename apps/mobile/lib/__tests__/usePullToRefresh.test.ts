import { act, renderHook } from '@testing-library/react-native';
import { usePullToRefresh } from '../usePullToRefresh';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePullToRefresh', () => {
  it('starts idle — mounting never shows a spinner', async () => {
    const { result } = await renderHook(() => usePullToRefresh(jest.fn(async () => {})));
    expect(result.current.refreshing).toBe(false);
  });

  it('shows the spinner only while a pull-triggered refetch is in flight', async () => {
    const d = deferred();
    const refetch = jest.fn(() => d.promise);
    const { result } = await renderHook(() => usePullToRefresh(refetch));

    let pull!: Promise<void>;
    await act(async () => {
      pull = result.current.onRefresh();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      d.resolve();
      await pull;
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('dismisses the spinner even when the refetch fails', async () => {
    const d = deferred();
    const refetch = jest.fn(() => d.promise);
    const { result } = await renderHook(() => usePullToRefresh(refetch));

    let pull!: Promise<void>;
    await act(async () => {
      pull = result.current.onRefresh();
    });
    expect(result.current.refreshing).toBe(true);

    await act(async () => {
      d.reject(new Error('offline'));
      await expect(pull).rejects.toThrow('offline');
    });
    expect(result.current.refreshing).toBe(false);
  });

  it('a background refetch does not touch the spinner', async () => {
    // The hook exposes no way to set `refreshing` from query state at all —
    // calling the refetch directly (as an invalidation would) must leave it false.
    const refetch = jest.fn(async () => {});
    const { result } = await renderHook(() => usePullToRefresh(refetch));

    await act(async () => {
      await refetch();
    });
    expect(result.current.refreshing).toBe(false);
  });
});
