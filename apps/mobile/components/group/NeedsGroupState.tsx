import { useRouter } from 'expo-router';
import { EmptyState } from '../ui';

/**
 * What a user in no groups is told, wherever they meet it (PLA-68).
 *
 * The feed and the create sheet both reach this state, and before this they
 * said different things about it: the feed told you to start a plan, and the
 * sheet said nothing at all and disabled its own button. One component so
 * there is one story, and one destination — the Groups tab, which already
 * offers both doors, invite link first.
 */
export function NeedsGroupState({
  body = 'A plan goes to one group, not to everybody. Join one or start one, and your plans land here.',
  dismissFirst = false,
  testID,
}: {
  /**
   * The last line is the only part that moves. "Your plans land here" is true
   * on the feed and wrong inside the create sheet, which is not where plans
   * land.
   */
  body?: string;
  /** Set on a modal: the sheet has to be gone before the tab underneath changes. */
  dismissFirst?: boolean;
  testID?: string;
}) {
  const router = useRouter();

  const goToGroups = () => {
    if (!dismissFirst) {
      router.navigate('/(app)/(tabs)/groups');
      return;
    }
    // A cold deep link opens the sheet with nothing behind it, and `back()`
    // there is a no-op that logs "GO_BACK was not handled by any navigator"
    // and leaves you sitting on the sheet. Replacing it is the exit that
    // works whether or not there is a stack.
    if (!router.canGoBack()) {
      router.replace('/(app)/(tabs)/groups');
      return;
    }
    router.back();
    // Same ordering the new-group sheet needs after it creates one
    // (group/new.tsx:101): navigating while the sheet is still on screen
    // lands the tab change behind it.
    setTimeout(() => router.navigate('/(app)/(tabs)/groups'), 100);
  };

  return (
    <EmptyState
      title="Plans need a group first"
      body={body}
      ctaLabel="Sort out a group"
      onPress={goToGroups}
      testID={testID}
    />
  );
}
