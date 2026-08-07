import { View, StyleSheet, Switch } from 'react-native';
import { ThemedText } from '../ui';
import { colors, spacing } from '../../theme/tokens';

interface Props {
  label: string;
  /** What "off" means, which is the half a label cannot say. */
  caption: string;
  value: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  /** Every row but the first in a card draws the line above itself. */
  divided?: boolean;
  testID: string;
}

/**
 * One switch in a settings card.
 *
 * Manage stacks three of these cards ("How it runs", "Who gets in") directly on
 * top of each other, so a row that styled itself would have to be corrected in
 * three files to stay looking like its neighbours.
 */
export function PrefSwitchRow({
  label,
  caption,
  value,
  disabled,
  onChange,
  divided = false,
  testID,
}: Props) {
  return (
    <View style={[settingsStyles.prefRow, divided && settingsStyles.divider]}>
      <View style={styles.body}>
        <ThemedText variant="bodyStrong">{label}</ThemedText>
        <ThemedText variant="caption">{caption}</ThemedText>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: colors.borderStrong, true: colors.accent }}
        ios_backgroundColor={colors.borderStrong}
        testID={testID}
      />
    </View>
  );
}

/** Shared by every settings card on Manage, switch rows and pressable rows alike. */
export const settingsStyles = StyleSheet.create({
  section: {
    gap: 10,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: spacing.lg,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  note: {
    paddingHorizontal: spacing.xs,
  },
});

const styles = StyleSheet.create({
  body: {
    flex: 1,
    gap: 3,
  },
});
