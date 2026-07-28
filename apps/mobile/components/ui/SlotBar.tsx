import { View, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme/tokens';

interface SlotBarProps {
  /** People in (yes-RSVPs or best-date availability) */
  going: number;
  /** The floor — plan happens at this many */
  min: number;
  /** The ceiling — optional cap; defaults to min when absent */
  cap?: number | null;
  testID?: string;
}

/**
 * The floor-and-ceiling visual from the plan detail card: one slot per place
 * up to the cap. Filled slots take the accent (green once the floor is met),
 * unfilled slots up to the floor are outlined (they're required), and slots
 * between floor and cap are quiet placeholders.
 */
export function SlotBar({ going, min, cap, testID }: SlotBarProps) {
  const total = Math.max(cap ?? min, min, going, 1);
  const confirmed = going >= min;
  const fillColor = confirmed ? colors.confirmed : colors.accent;

  return (
    <View
      style={styles.row}
      testID={testID}
      accessibilityLabel={`${going} in, minimum ${min}${cap ? `, room for ${total}` : ''}`}
    >
      {Array.from({ length: total }, (_, i) => {
        const filled = i < going;
        const required = i < min;
        return (
          <View
            key={i}
            testID={filled ? 'slot-filled' : required ? 'slot-required' : 'slot-optional'}
            style={[
              styles.slot,
              filled
                ? { backgroundColor: fillColor }
                : required
                  ? styles.required
                  : styles.optional,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  slot: {
    flex: 1,
    height: 12,
    borderRadius: radii.pill,
  },
  required: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  optional: {
    backgroundColor: colors.surfaceSunken,
  },
});
