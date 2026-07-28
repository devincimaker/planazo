import { View, StyleSheet } from 'react-native';
import { Avatar } from './Avatar';
import { ThemedText } from './ThemedText';
import { colors } from '../../theme/tokens';

interface AvatarStackProps {
  names: string[];
  max?: number;
  size?: number;
  label?: string;
}

/** Overlapping faces row with a "+N" tail and an optional trailing label. */
export function AvatarStack({ names, max = 5, size = 26, label }: AvatarStackProps) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;

  return (
    <View style={styles.row}>
      <View style={styles.stack}>
        {shown.map((name, i) => (
          <View key={`${name}-${i}`} style={[styles.ring, { borderRadius: (size + 4) / 2 }]}>
            <Avatar name={name} size={size} />
          </View>
        ))}
        {extra > 0 ? (
          <View
            style={[
              styles.ring,
              styles.extra,
              { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 },
            ]}
          >
            <ThemedText variant="tag" color={colors.textSecondary} testID="avatar-stack-extra">
              +{extra}
            </ThemedText>
          </View>
        ) : null}
      </View>
      {label ? (
        <ThemedText variant="caption" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stack: {
    flexDirection: 'row',
  },
  ring: {
    borderWidth: 2,
    borderColor: colors.surface,
    marginRight: -8,
    backgroundColor: colors.surface,
  },
  extra: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSunken,
  },
  label: {
    paddingLeft: 14,
  },
});
