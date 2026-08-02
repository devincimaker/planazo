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
          style={[styles.input, secure && styles.inputWithReveal]}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={LINK_HIT_SLOP}
            onPress={() => setRevealed((v) => !v)}
            style={styles.reveal}
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
  // No padding here. It used to live on this wrapper, which made the box look
  // 51pt tall while only the ~21pt text line actually took a tap — press the
  // top or bottom third of a field and nothing happened. The padding belongs
  // on the input, so the whole visible box is the input.
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 18,
  },
  inputWrapFocused: {
    borderColor: colors.accent,
  },
  input: {
    flex: 1,
    fontFamily: fonts.bodySemiBold,
    fontSize: 17,
    color: colors.textPrimary,
    // Same 15/16 as the wrapper carried before, so nothing moves visually.
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    // Belt and braces for large text settings and short line heights alike:
    // the tap target never drops under Apple's 44pt however the text renders.
    minHeight: 44,
  },
  inputWithReveal: {
    // Leave the reveal control its own room rather than running under it.
    paddingRight: spacing.md,
  },
  reveal: {
    justifyContent: 'center',
    paddingRight: spacing.lg,
  },
  hint: {
    lineHeight: 19,
  },
});
