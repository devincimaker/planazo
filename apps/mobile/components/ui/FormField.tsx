import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, TextInputProps, View } from 'react-native';
import { ThemedText } from './ThemedText';
import { LINK_HIT_SLOP } from '../../lib/a11y';
import { colors, fonts, spacing } from '../../theme/tokens';

interface FormFieldProps extends Omit<TextInputProps, 'style' | 'secureTextEntry'> {
  label: string;
  /** Caption under the field explaining what the value is for */
  hint?: string;
  /** Renders the reveal toggle and starts masked */
  secure?: boolean;
  testID?: string;
}

/**
 * The auth form field from the design doc: uppercase label, surface box that
 * borders ember while focused, and a caption slot underneath. Password fields
 * carry their own reveal toggle rather than a separate "confirm" field —
 * seeing what you typed is what confirming was for.
 */
export function FormField({ label, hint, secure = false, testID, ...rest }: FormFieldProps) {
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.field}>
      {/* Decorative to a screen reader: the input below carries the same words
          as its own accessibilityLabel, so leaving this visible to VoiceOver
          would read the label twice and still leave the field unnamed. React
          Native has no htmlFor — naming the input *is* the association. */}
      <ThemedText variant="sectionLabel" accessibilityElementsHidden importantForAccessibility="no">
        {label}
      </ThemedText>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        <TextInput
          {...rest}
          testID={testID}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          accessibilityHint={rest.accessibilityHint ?? hint}
          secureTextEntry={secure && !revealed}
          placeholderTextColor={colors.textFaint}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={styles.input}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={LINK_HIT_SLOP}
            onPress={() => setRevealed((v) => !v)}
            testID={testID ? `${testID}-reveal` : undefined}
          >
            <ThemedText variant="caption" color={colors.accentText}>
              {revealed ? 'Hide' : 'Show'}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
      {hint ? (
        <ThemedText variant="caption" style={styles.hint}>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 18,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
  },
  inputWrapFocused: {
    borderColor: colors.accent,
  },
  input: {
    flex: 1,
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: colors.textPrimary,
    padding: 0,
  },
  hint: {
    lineHeight: 19,
  },
});
