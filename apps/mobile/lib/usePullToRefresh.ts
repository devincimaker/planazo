import { useCallback, useState } from 'react';

/**
 * Drives a RefreshControl from the user's pull and nothing else. Wiring
 * `refreshing` to react-query's `isRefetching` lets any invalidation-driven
 * background refetch raise the spinner, and one that lands mid navigation
 * transition latches the native control visible even after `isRefetching`
 * returns to false (PLA-52). Background refetches stay silent; the content
 * simply updates.
 */
export function usePullToRefresh(refetch: () => Promise<unknown>) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return { refreshing, onRefresh };
}
