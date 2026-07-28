import { View, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors, radii } from '../../theme/tokens';

type BadgeTone = 'open' | 'confirmed' | 'muted' | 'custom';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  bg?: string;
  fg?: string;
  uppercase?: boolean;
}

const tones: Record<Exclude<BadgeTone, 'custom'>, { bg: string; fg: string }> = {
  open: { bg: colors.accentSoft, fg: colors.accentPressed },
  confirmed: { bg: colors.confirmedSoft, fg: colors.confirmed },
  muted: { bg: colors.surfaceSunken, fg: colors.textSecondary },
};

export function Badge({ label, tone = 'muted', bg, fg, uppercase = false }: BadgeProps) {
  const resolved = tone === 'custom' ? { bg: bg!, fg: fg! } : tones[tone];
  return (
    <View style={[styles.base, { backgroundColor: resolved.bg }]}>
      <ThemedText
        variant="tag"
        color={resolved.fg}
        style={uppercase ? styles.uppercase : null}
      >
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  uppercase: {
    textTransform: 'uppercase',
    letterSpacing: 0.36,
  },
});
