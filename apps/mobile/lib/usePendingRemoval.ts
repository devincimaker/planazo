import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { showToast } from '../components/ui';

/**
 * How long "X is out of the group" stays up, and therefore how long the
 * removal is only a promise.
 *
 * Undo has to be real or it should not be offered, and the database rules out
 * the obvious implementation: PLA-35 dropped the group_members INSERT policy,
 * so the client cannot put anybody back, and `on_group_member_delete` deletes
 * their RSVPs and date answers for every plan in the group on the way out. A
 * re-add would restore the membership and none of the rest of it.
 *
 * So the row goes at once and the DELETE waits here instead. Undo cancels a
 * statement that never ran. The window closes early — and the removal lands —
 * if the screen is left or the app is backgrounded, because a promise the user
 * has walked away from has to resolve one way or the other.
 */
export const UNDO_WINDOW_MS = 5000;

/**
 * Holds one removal for {@link UNDO_WINDOW_MS} before it reaches the database,
 * with the undo living in the toast.
 *
 * `pendingRemovalId` is who to hide from the list meanwhile: somebody with a
 * removal pending is already gone from it, because the undo is in the toast
 * and not in a half-there row.
 */
export function usePendingRemoval(remove: (userId: string) => void) {
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  // Only one removal is ever in flight.
  const pendingRemoval = useRef<{ userId: string; timer: ReturnType<typeof setTimeout> } | null>(
    null
  );
  // `mutate` is stable, but the unmount path runs after the last render and has
  // no business reading a closure from it.
  const removeRef = useRef(remove);
  removeRef.current = remove;

  /** Take the pending removal off the books and hand it back, if there is one. */
  const takePending = useCallback(() => {
    const held = pendingRemoval.current;
    if (!held) return null;
    clearTimeout(held.timer);
    pendingRemoval.current = null;
    return held;
  }, []);

  const commitRemoval = useCallback(() => {
    const held = takePending();
    if (!held) return;
    setPendingRemovalId(null);
    removeRef.current(held.userId);
  }, [takePending]);

  const undoRemoval = useCallback(() => {
    const held = takePending();
    if (!held) return;
    setPendingRemovalId(null);
  }, [takePending]);

  const startRemoval = useCallback(
    (userId: string, name: string) => {
      // A second removal closes the first one's window rather than queueing
      // behind it: two undos with one toast is one undo nobody can aim.
      commitRemoval();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setPendingRemovalId(userId);
      pendingRemoval.current = {
        userId,
        timer: setTimeout(() => commitRemoval(), UNDO_WINDOW_MS),
      };
      showToast(`${name} is out of the group`, {
        action: { label: 'Undo', onPress: undoRemoval, testID: 'undo-remove' },
        durationMs: UNDO_WINDOW_MS,
      });
    },
    [commitRemoval, undoRemoval]
  );

  // Backgrounding the app, or leaving the screen, closes the window early.
  // Without this the row is gone from the list and the person is still in the
  // group, and nothing on screen would ever say so.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') commitRemoval();
    });
    return () => sub.remove();
  }, [commitRemoval]);

  useEffect(
    () => () => {
      const held = takePending();
      if (held) removeRef.current(held.userId);
    },
    [takePending]
  );

  return { pendingRemovalId, startRemoval };
}
