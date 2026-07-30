import { Pressable, View, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, spacing } from '../../theme/tokens';

interface ListRowProps {
  title: string;
  value?: string;
  /** Custom right-side element; wins over `value` */
  right?: React.ReactNode;
  onPress?: () => void;
  /** Draw the separator above this row (use on every row but the first) */
  divider?: boolean;
  destructive?: boolean;
  /** Line-through, muted — a cancelled plan's date (19a) */
  struck?: boolean;
  testID?: string;
}

/** Settings/detail row inside a Card (padded={false}). */
export function ListRow({ title, value, right, onPress, divider = false, destructive = false, struck = false, testID }: ListRowProps) {
  const content = (
    <>
      <ThemedText
        variant="body"
        color={destructive ? colors.accentPressed : struck ? colors.textSecondary : colors.textPrimary}
        style={[styles.title, struck && styles.struck]}
        numberOfLines={1}
      >
        {title}
      </ThemedText>
      {right ??
        (value ? (
          <ThemedText
            variant="rowValue"
            color={struck ? colors.textSecondary : colors.textPrimary}
            numberOfLines={1}
            style={[styles.value, struck && styles.struck]}
          >
            {value}
          </ThemedText>
        ) : onPress ? (
          <ThemedText variant="body" color={colors.textFaint}>
            ›
          </ThemedText>
        ) : null)}
    </>
  );

  const rowStyle = [styles.row, divider && styles.divider];

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [rowStyle, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  title: {
    flexShrink: 1,
  },
  value: {
    flexShrink: 1,
    textAlign: 'right',
  },
  struck: {
    textDecorationLine: 'line-through',
    textDecorationColor: colors.endedMuted,
  },
  pressed: {
    backgroundColor: colors.surfaceSunken,
  },
});
