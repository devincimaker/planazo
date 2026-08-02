import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, radii, spacing } from '../../theme/tokens';

interface ConfirmCardProps {
  title: string;
  /** Plain string, or rich copy when part of it needs emphasis */
  children: ReactNode;
  testID?: string;
}

/**
 * The "we did the thing, now go look at your inbox" card from design 1a.
 * A green tick rather than the ember, because nothing here needs answering.
 */
export function ConfirmCard({ title, children, testID }: ConfirmCardProps) {
  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.tick}>
        <ThemedText variant="bodyStrong" color={colors.confirmed} style={styles.tickGlyph}>
          ✓
        </ThemedText>
      </View>
      <ThemedText variant="cardTitle">{title}</ThemedText>
      <ThemedText variant="body" color={colors.textSecondary}>
        {children}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
    padding: spacing.xxl,
    gap: 14,
  },
  tick: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.confirmedSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
});
