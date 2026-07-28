import { Pressable, StyleSheet, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './ThemedText';
import { colors, fonts, radii } from '../../theme/tokens';

type ButtonVariant = 'primary' | 'secondary' | 'outline';
type ButtonSize = 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  haptic?: boolean;
  style?: ViewStyle;
  testID?: string;
}

const textColor: Record<ButtonVariant, string> = {
  primary: colors.textOnAccent,
  secondary: colors.textSecondary,
  outline: colors.textSecondary,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  haptic = true,
  style,
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
        style={[styles.label, size === 'lg' && styles.labelLg]}
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
  },
  md: {
    paddingVertical: 12,
    paddingHorizontal: 16,
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
  otherPressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontFamily: fonts.bodyBold,
  },
  labelLg: {
    fontSize: 16,
    lineHeight: 20,
  },
});
