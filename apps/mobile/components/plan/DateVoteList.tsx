import { View, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import type { DateCount } from '@planazo/shared';
import { fmtDay } from '../../lib/dates';
import { ThemedText, Badge } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';

type Props = {
  dateOptions?: any[];
  countByDate: Record<string, DateCount>;
  leadId: string | null;
  picked: string[];
  minPeople: number;
  onToggle: (optionId: string) => void;
};

/** The "Which days work" vote rows on an open flexible plan. */
export function DateVoteList({ dateOptions, countByDate, leadId, picked, minPeople, onToggle }: Props) {
  return (
    <Animated.View
      entering={FadeInDown}
      exiting={FadeOutUp}
      layout={LinearTransition}
      style={styles.section}
    >
      <ThemedText variant="sectionLabel">Which days work</ThemedText>
      {(dateOptions ?? []).map((opt) => {
        const count = countByDate[opt.id]?.count ?? 0;
        const mine = picked.includes(opt.id);
        const isLead = opt.id === leadId && count > 0;
        const ratio = Math.min(count / minPeople, 1);
        return (
          <Pressable
            key={opt.id}
            onPress={() => onToggle(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: mine }}
            testID={`vote-${opt.id}`}
            style={[styles.dateCard, mine && styles.dateCardMine]}
          >
            <View style={styles.dateTop}>
              <View style={styles.dateLabelRow}>
                <ThemedText
                  variant="bodyStrong"
                  color={mine ? colors.accentPressed : colors.textPrimary}
                  style={styles.dateLabel}
                >
                  {fmtDay(opt.date)}
                </ThemedText>
                {isLead ? <Badge label="Leading" tone="muted" uppercase /> : null}
              </View>
              <View style={styles.dateMetaRow}>
                <ThemedText variant="caption" color={mine ? colors.accentPressed : colors.textMuted}>
                  {count} free
                </ThemedText>
                <ThemedText variant="bodyStrong" color={colors.accent} style={styles.mark}>
                  {mine ? '✓' : ''}
                </ThemedText>
              </View>
            </View>
            <View style={styles.track}>
              <View
                style={[
                  styles.trackFill,
                  {
                    width: `${Math.round(ratio * 100)}%`,
                    backgroundColor: count >= minPeople ? colors.confirmed : colors.accent,
                  },
                ]}
              />
            </View>
          </Pressable>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  dateCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 20,
    padding: spacing.lg,
    gap: 9,
  },
  dateCardMine: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  dateTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dateLabel: {
    fontSize: 16,
  },
  dateMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mark: {
    width: 14,
    textAlign: 'center',
  },
  track: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  trackFill: {
    height: 6,
    borderRadius: radii.pill,
  },
});
