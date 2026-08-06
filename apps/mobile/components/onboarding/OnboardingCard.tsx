import { ReactNode } from 'react';
import { View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { ThemedText } from '../ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

/** The design's card inset. Between spacing.xl and spacing.xxl, and drawn as 22. */
const CARD_PADDING = 22;

interface OnboardingCardProps {
  title: string;
  body: string;
  /** Width is the deck's to decide: it falls out of the screen (see onboarding.tsx). */
  width: number;
  /** A group colour along the top edge, as a group's own card wears one. */
  stripe?: string;
  children: ReactNode;
  testID?: string;
}

/**
 * One page of the first-run deck (PLA-75): a headline, a line of copy, and a
 * still life of the part of the app being described.
 *
 * The art is `children` rather than a prop so each card composes its own; wrap
 * it in {@link CardArt}, which is where the shared decisions about it live.
 */
export function OnboardingCard({
  title,
  body,
  width,
  stripe,
  children,
  testID,
}: OnboardingCardProps) {
  return (
    <View style={[styles.card, { width }]} testID={testID}>
      {stripe ? <View style={[styles.stripe, { backgroundColor: stripe }]} /> : null}
      <View style={styles.inner}>
        <View style={styles.heading}>
          {/* The design sets these headlines in the 700 cut at 26, not the 800
              `headerTitle` wears elsewhere. Kept as a variant override so the
              accessibility scale cap on headerTitle still applies. */}
          <ThemedText variant="headerTitle" style={styles.title}>
            {title}
          </ThemedText>
          <ThemedText variant="body" color={colors.textSecondary}>
            {body}
          </ThemedText>
        </View>
        {children}
      </View>
    </View>
  );
}

/**
 * The still life on a card, and the one place the decision to hide it from
 * VoiceOver lives.
 *
 * Every card's art is a picture of controls rather than controls: an "Add"
 * button nobody can press, a date row that answers no tap. Announcing those is
 * a worse lie than a picture that says nothing, so the whole block is hidden
 * and the headline and copy carry the meaning instead. Keeping it here rather
 * than repeated in each card is what stops a fifth card forgetting.
 *
 * Fills the space the headline leaves, so a card's last element sits on the
 * floor without needing `marginTop: 'auto'` of its own.
 */
export function CardArt({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <View
      style={[styles.art, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  art: {
    flex: 1,
    gap: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    // The stripe runs to the card's edge, so the corners have to clip it.
    overflow: 'hidden',
  },
  stripe: {
    height: 4,
  },
  inner: {
    flex: 1,
    padding: CARD_PADDING,
    gap: spacing.xl,
  },
  heading: {
    gap: 10,
  },
  title: {
    fontFamily: fonts.display,
    lineHeight: 29,
  },
});
