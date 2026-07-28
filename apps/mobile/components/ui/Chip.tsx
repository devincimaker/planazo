import { Pressable, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, radii } from '../../theme/tokens';

interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  testID?: string;
}

/** Filter pill (feed header): active = ink, inactive = outlined. */
export function Chip({ label, active = false, onPress, testID }: ChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        active ? styles.active : styles.inactive,
        pressed && styles.pressed,
      ]}
    >
      <ThemedText
        variant="bodyStrong"
        style={styles.label}
        color={active ? colors.background : colors.textSecondary}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  active: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  inactive: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    fontSize: 14,
    lineHeight: 18,
  },
});
