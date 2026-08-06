import { useRouter } from 'expo-router';
import { useDismissTo } from '../../lib/navigation';
import { EmptyState } from '../ui';

const GROUPS_TAB = '/(app)/(tabs)/groups' as const;

/**
 * Said in one place so the feed, the sheet and the create screen cannot drift
 * apart. Only the last line moves: "your plans land here" is true on the feed
 * and wrong anywhere a plan is being composed.
 */
export const NEEDS_GROUP_COPY = {
  title: 'Plans need a group first',
  feedBody:
    'A plan goes to one group, not to everybody. Join one or start one, and your plans land here.',
  planBody:
    'A plan goes to one group, not to everybody. Join one or start one, then come back and post this.',
  cta: 'Sort out a group',
} as const;

/**
 * Leaving for the Groups tab from wherever this is shown.
 *
 * `dismissFirst` is for a modal or sheet, which has to be gone before the tab
 * underneath changes.
 */
export function useGoToGroups(dismissFirst = false) {
  const router = useRouter();
  const dismiss = useDismissTo(GROUPS_TAB);

  return () => {
    if (!dismissFirst) {
      router.navigate(GROUPS_TAB);
      return;
    }
    // A dismissal that replaced the route has already arrived at the tab.
    // One that popped a screen has not, and navigating before the sheet is
    // gone lands the tab change behind it — the same ordering the new-group
    // sheet needs after it creates one (group/new.tsx:101).
    if (dismiss()) {
      setTimeout(() => router.navigate(GROUPS_TAB), 100);
    }
  };
}

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
  body = NEEDS_GROUP_COPY.feedBody,
  dismissFirst = false,
  testID,
}: {
  body?: string;
  /** Set on a modal: the sheet has to be gone before the tab underneath changes. */
  dismissFirst?: boolean;
  testID?: string;
}) {
  const goToGroups = useGoToGroups(dismissFirst);

  return (
    <EmptyState
      title={NEEDS_GROUP_COPY.title}
      body={body}
      ctaLabel={NEEDS_GROUP_COPY.cta}
      onPress={goToGroups}
      testID={testID}
    />
  );
}
