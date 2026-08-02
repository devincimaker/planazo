import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './ThemedText';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { colors, fonts, radii } from '../../theme/tokens';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ink' | 'accentOutline' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  haptic?: boolean;
  style?: ViewStyle;
  /**
   * One line by default — a button is a target, not a paragraph. Layouts that
   * can give a label the whole width (see ButtonRow) pass `0`, RN's "as many
   * lines as it takes", so a long label wraps at spaces instead of losing its
   * end to an ellipsis. Any cap is a guess at how many lines a label needs, and
   * the text size is the caller's to change: "Tap the dates you can do" wants
   * three lines at the largest accessibility size (PLA-22 review).
   *
   * Allowing more doesn't widen the button — text measures at its single-line
   * width whatever this says, so extra lines are only used once the box is
   * already too narrow, and the surrounding layout is unaffected.
   */
  numberOfLines?: number;
  testID?: string;
}

const textColor: Record<ButtonVariant, string> = {
  primary: colors.textOnAccent,
  secondary: colors.textSecondary,
  outline: colors.textSecondary,
  ink: colors.background,
  accentOutline: colors.accent,
  danger: colors.textOnAccent,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  haptic = true,
  style,
  numberOfLines = 1,
  testID,
}: ButtonProps) {
  const handlePress = () => {
    if (haptic) {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={handlePress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        size === 'md' ? styles.md : styles.lg,
        pressed && variant === 'primary' && styles.primaryPressed,
        pressed && variant !== 'primary' && styles.otherPressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <ThemedText
        variant={size === 'md' ? 'bodyStrong' : 'body'}
        color={textColor[variant]}
        numberOfLines={numberOfLines}
        style={[styles.label, size === 'md' ? styles.labelMd : styles.labelLg]}
      >
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    // `lg` clears 44 on its padding alone; `md` came to 42 (12 + 18 + 12) and
    // a wrapped label is the caller's to ask for, so the floor lives here
    // rather than in either size.
    minHeight: MIN_TOUCH_TARGET,
  },
  md: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radii.row,
  },
  lg: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: radii.footerButton,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  primaryPressed: {
    backgroundColor: colors.accentPressed,
  },
  ink: {
    backgroundColor: colors.ink,
  },
  secondary: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  outline: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  // The quiet undo (19b/19c): an outline in the accent, never the filled ember.
  accentOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  // The loud act, once already chosen (20b's filled "Call it off").
  danger: {
    backgroundColor: colors.accentPressed,
  },
  otherPressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: fonts.bodyBold,
    // A no-op on one line (the text box hugs its own width) — it's the wrapped
    // label that would otherwise sit ragged-right inside a centred button.
    textAlign: 'center',
  },
  labelMd: {
    fontSize: 14,
    lineHeight: 18,
  },
  labelLg: {
    fontSize: 16,
    lineHeight: 20,
  },
});
