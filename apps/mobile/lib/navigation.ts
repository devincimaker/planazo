import { useRouter, type Href } from 'expo-router';

/**
 * Leaving a modal or sheet, including one a deep link opened directly.
 *
 * `planazo://plan/create` and its like mount their screen with nothing behind
 * it, and `router.back()` there is a no-op: it logs "GO_BACK was not handled
 * by any navigator" and leaves the user sitting on a screen with no way out.
 * Replacing the route is the exit that works either way.
 *
 * Returns whether a screen was actually popped, because that is the only case
 * where anything meant to happen *after* the dismissal has to wait for the
 * animation. A replace has already arrived.
 */
export function useDismissTo(fallback: Href) {
  const router = useRouter();

  return () => {
    if (!router.canGoBack()) {
      router.replace(fallback);
      return false;
    }
    router.back();
    return true;
  };
}
