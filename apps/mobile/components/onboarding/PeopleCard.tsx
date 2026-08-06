import { View, StyleSheet } from 'react-native';
import { OnboardingCard, CardArt } from './OnboardingCard';
import { ThemedText, Avatar } from '../ui';
import { colors, fonts, groupColors, radii, spacing } from '../../theme/tokens';

interface PersonProps {
  name: string;
  handle: string;
  bg: string;
  action: string;
  /** The ember pill (you can act) versus the quiet one (you already did). */
  pending?: boolean;
  divided?: boolean;
}

function Person({ name, handle, bg, action, pending = false, divided = false }: PersonProps) {
  return (
    <View style={[styles.person, divided && styles.divided]}>
      <Avatar name={name} bg={bg} size={42} />
      <View style={styles.identity}>
        <ThemedText style={styles.name}>{name}</ThemedText>
        <ThemedText variant="caption">{handle}</ThemedText>
      </View>
      <View style={[styles.pill, pending ? styles.pillQuiet : styles.pillLoud]}>
        <ThemedText
          variant="caption"
          color={pending ? colors.textMuted : colors.textOnAccent}
          style={styles.pillLabel}
        >
          {action}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * Page 1: how anybody gets into your Planazo at all. Search by handle, or send
 * a link to someone who isn't here yet.
 *
 * The art is a still life of Find people, hidden from VoiceOver by CardArt.
 */
export function PeopleCard({ width }: { width: number }) {
  return (
    <OnboardingCard
      width={width}
      title="Find your people"
      body="Add a friend by @handle, or send them a link. Put them in groups: the flatmates, the padel lot, the ones who actually turn up."
      testID="onboarding-people"
    >
      <CardArt style={styles.art}>
        <View style={styles.search}>
          <View style={styles.magnifier}>
            <View style={styles.lens} />
            <View style={styles.handle} />
          </View>
          <ThemedText color={colors.textFaint} style={styles.searchText}>
            Name or @handle
          </ThemedText>
        </View>

        <Person name="Nacho Pardo" handle="@nacho" bg={groupColors[1]} action="Add" />
        <Person
          name="Sofi Aguirre"
          handle="@sofia"
          bg={groupColors[0]}
          action="Requested"
          pending
          divided
        />
      </CardArt>

      <View style={styles.invite}>
        <ThemedText variant="bodyStrong" color={colors.accentText} style={styles.inviteLabel}>
          Send an invite link
        </ThemedText>
      </View>
    </OnboardingCard>
  );
}

const styles = StyleSheet.create({
  // Tighter than CardArt's default: the field and the rows it filters are one
  // block, not three separate beats.
  art: {
    gap: 10,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radii.input,
    paddingHorizontal: 15,
  },
  searchText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 16,
    paddingVertical: 13,
  },
  // Two rectangles standing in for a magnifier: a ring and a stroke at 45°.
  magnifier: {
    width: 15,
    height: 14,
  },
  lens: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 11,
    height: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
  },
  handle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 8,
    height: 2,
    backgroundColor: colors.textMuted,
    transform: [{ rotate: '45deg' }],
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 11,
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  identity: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  name: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  pill: {
    borderRadius: radii.pill,
    paddingVertical: 9,
    paddingHorizontal: spacing.lg,
  },
  pillLoud: {
    backgroundColor: colors.accent,
  },
  pillQuiet: {
    backgroundColor: colors.surfaceSunken,
  },
  pillLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    lineHeight: 18,
  },
  invite: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radii.footerButton,
    padding: 15,
  },
  inviteLabel: {
    fontFamily: fonts.bodyBold,
  },
});
