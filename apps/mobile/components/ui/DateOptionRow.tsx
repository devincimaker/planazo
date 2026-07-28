import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, radii } from '../../theme/tokens';

interface DateOptionRowProps {
  label: string;
  /** Right-side meta, e.g. "4 in" or "You + 4" */
  meta?: string;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
}

/** A tappable date option (flexible plans, inline in feed and detail). */
export function DateOptionRow({ label, meta, selected = false, onPress, testID }: DateOptionRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        selected ? styles.selected : styles.unselected,
        pressed && styles.pressed,
      ]}
    >
      <ThemedText
        variant="bodyStrong"
        color={selected ? colors.accentPressed : colors.textPrimary}
      >
        {label}
      </ThemedText>
      {meta ? (
        <ThemedText
          variant="caption"
          color={selected ? colors.accentPressed : colors.textMuted}
        >
          {meta}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: radii.input,
    borderWidth: 1.5,
  },
  selected: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  unselected: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  pressed: {
    opacity: 0.85,
  },
});
