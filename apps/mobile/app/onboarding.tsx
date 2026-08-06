import { useCallback, useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { BrandMark } from '../components/ui';
import { PeopleCard, PlanCard, PollCard, AlbumCard } from '../components/onboarding';
import { useFinishOnboarding } from '../lib/useOnboarding';
import { colors, radii, spacing } from '../theme/tokens';

const PAGES = 4;
/** Where the card's left edge sits, and how much of the next one shows past it. */
const SIDE = 35;
const PEEK = 19;
const GAP = spacing.lg;
/** The design's 220ms ease on the progress fill. */
const SETTLE_MS = 220;

/**
 * The first-run deck (PLA-75), shown once to an account that has never seen it.
 *
 * A deck of peeking cards rather than full-bleed pages, which is what makes it
 * legible as a thing you swipe without a "swipe" instruction: there is visibly
 * another card to the right of the one you are reading.
 *
 * The card width falls out of the screen rather than being fixed at the
 * design's 320, so the 19pt peek survives every phone. At 390pt wide the
 * arithmetic lands back on exactly the numbers that were drawn.
 *
 * There is no Skip. Four cards with nothing to fill in is three swipes, and the
 * progress rule already says how much is left.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const finish = useFinishOnboarding();
  const [page, setPage] = useState(0);

  const cardWidth = width - SIDE - GAP - PEEK;
  const step = cardWidth + GAP;

  const progress = useSharedValue(1 / PAGES);
  useEffect(() => {
    progress.value = withTiming((page + 1) / PAGES, { duration: SETTLE_MS });
  }, [page, progress]);

  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  const onSettled = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const landed = Math.round(event.nativeEvent.contentOffset.x / step);
    setPage(Math.min(PAGES - 1, Math.max(0, landed)));
  };

  const getStarted = useCallback(() => {
    // Fire and forget: the flag is already set in the store, and the deck has
    // done its job whether or not the write reaches the server.
    void finish();
    // Groups, not the feed: a brand-new account's feed is empty, and the groups
    // tab is the one screen that offers something to do about it.
    router.replace('/(app)/(tabs)/groups');
  }, [finish, router]);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={styles.brand}>
        <BrandMark />
      </View>

      <View style={styles.deck}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={step}
          snapToAlignment="start"
          decelerationRate="fast"
          onMomentumScrollEnd={onSettled}
          contentContainerStyle={styles.track}
          testID="onboarding-deck"
        >
          <PeopleCard width={cardWidth} />
          <PlanCard width={cardWidth} />
          <PollCard width={cardWidth} />
          <AlbumCard width={cardWidth} onGetStarted={getStarted} />
        </ScrollView>
      </View>

      <View style={styles.progressWrap}>
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityLabel="How far through the intro you are"
          accessibilityValue={{ min: 1, max: PAGES, now: page + 1 }}
          testID="onboarding-progress"
        >
          <Animated.View style={[styles.progressFill, fill]} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  brand: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  deck: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  track: {
    paddingHorizontal: SIDE,
    gap: GAP,
    // Stretch rather than a fixed 600: the cards take whatever height the deck
    // has, so a small phone shortens them instead of clipping them.
    alignItems: 'stretch',
  },
  progressWrap: {
    paddingHorizontal: 55,
    paddingBottom: spacing.md,
  },
  progressTrack: {
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
