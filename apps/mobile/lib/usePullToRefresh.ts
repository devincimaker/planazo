import { useCallback, useState } from 'react';

/**
 * Drives a RefreshControl from the user's pull and nothing else. Wired to
 * react-query's `isRefetching` instead, a background refetch landing mid
 * navigation transition latches the native control visible even after the
 * query settles (PLA-52).
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
