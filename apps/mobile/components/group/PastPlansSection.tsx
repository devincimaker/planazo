import { useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, AvatarStack } from '../ui';
import { colors, fonts, spacing } from '../../theme/tokens';

/** One plan's slice of the rows the group screen derives, as the Past section reads it. */
export interface PastPlanRow {
  id: string;
  title: string;
  ending: 'cancelled' | 'expired' | 'happened' | null;
  endingLine: string;
  wentNames: string[];
  wentLabel: string;
  endDate: string | null;
}

/**
 * 19d: three endings, one Past section. Closed by default — it costs one line
 * until you want it. A plan that happened keeps its white card and the faces
 * of who was there; the two non-events sink into flat stone with one line of
 * explanation.
 */
export function PastPlansSection({ rows }: { rows: PastPlanRow[] }) {
  const router = useRouter();
  const [showPast, setShowPast] = useState(false);

  if (rows.length === 0) return null;

  const renderPastRow = (p: PastPlanRow) => {
    const d = p.endDate ? new Date(p.endDate) : null;
    const stone = p.ending !== 'happened';
    return (
      <Pressable
        key={p.id}
        onPress={() => router.push(`/(app)/plan/${p.id}`)}
        style={[styles.pastCard, stone && styles.pastCardStone]}
        testID={`past-row-${p.id}`}
      >
        <View style={[styles.dateTile, stone && styles.dateTileStone]}>
          <ThemedText variant="tag" color={stone ? colors.textMuted : colors.textSecondary} style={styles.dateTileMonth}>
            {d ? d.toLocaleDateString('en-GB', { month: 'short' }) : '—'}
          </ThemedText>
          <ThemedText variant="rowValue" color={stone ? colors.textMuted : colors.textSecondary} style={styles.dateTileDay}>
            {d ? d.getDate() : ''}
          </ThemedText>
        </View>
        <View style={styles.pastBody}>
          <ThemedText
            variant="rowValue"
            color={stone ? colors.textSecondary : colors.textPrimary}
            numberOfLines={1}
          >
            {p.title}
          </ThemedText>
          {p.ending === 'happened' ? (
            <View style={styles.wentRow}>
              <AvatarStack names={p.wentNames} label={p.wentLabel} />
            </View>
          ) : (
            <ThemedText variant="caption" color={colors.textMuted} style={styles.pastLine}>
              {p.endingLine}
            </ThemedText>
          )}
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setShowPast((s) => !s)}
        accessibilityRole="button"
        style={styles.pastHeader}
        testID="past-toggle"
      >
        <View style={styles.sectionHeader}>
          <ThemedText variant="sectionLabel">Past</ThemedText>
          <ThemedText variant="sectionLabel" color={colors.endedMuted}>
            {rows.length}
          </ThemedText>
        </View>
        <ThemedText variant="caption" color={colors.textMuted}>
          {showPast ? 'Hide ⌃' : 'Show ⌄'}
        </ThemedText>
      </Pressable>
      {showPast ? rows.map((p) => renderPastRow(p)) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pastHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    // Its content is 17pt tall. Reach the 44 by growing up into the 24pt gap
    // above rather than down into the 10pt one below, where the first past
    // card — tappable itself — would have ended up under this box (PLA-40).
    minHeight: MIN_TOUCH_TARGET,
    marginTop: -20,
    marginBottom: -7,
  },
  // 19d past cards: a happened plan keeps its white card and the faces of
  // who was there; called off and never-quite sink into flat stone.
  pastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg - 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: spacing.lg - 2,
  },
  pastCardStone: {
    backgroundColor: colors.pastCard,
    borderColor: colors.endedBadge,
  },
  dateTile: {
    width: 54,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tabBarBorder,
  },
  dateTileStone: {
    backgroundColor: colors.endedBadge,
  },
  dateTileMonth: {
    textTransform: 'uppercase',
    letterSpacing: 0.66,
    opacity: 0.75,
  },
  dateTileDay: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 24,
  },
  pastBody: {
    flex: 1,
    gap: 3,
  },
  wentRow: {
    marginTop: spacing.xxs,
  },
  pastLine: {
    fontFamily: fonts.body,
  },
});
