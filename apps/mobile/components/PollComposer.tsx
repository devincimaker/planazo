import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from './ui/ThemedText';
import { MAX_POLL_OPTIONS, type PollDraft } from '../lib/pollDraft';
import { colors, radii, spacing, type } from '../theme/tokens';

/**
 * The option list the host writes: one bordered row per option with a ✕ to
 * take it back out, and a ghost "Add another…" row that becomes real when
 * tapped. Shared by the new-poll sheet and the create sheet's collapsed
 * section so the two paths cannot drift. The draft logic itself lives in
 * lib/pollDraft.
 */
export function PollOptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const setOption = (i: number, text: string) =>
    onChange(options.map((o, j) => (j === i ? text : o)));

  // Removing below two pads back with blanks: the editor always shows at
  // least two rows, because a poll with fewer is not a poll.
  const removeOption = (i: number) => {
    const next = options.filter((_, j) => j !== i);
    while (next.length < 2) next.push('');
    onChange(next);
  };

  return (
    <View style={styles.fields}>
      {options.map((opt, i) => (
        <View key={i} style={styles.optionRow}>
          <TextInput
            style={styles.optionInput}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={colors.textFaint}
            value={opt}
            onChangeText={(text) => setOption(i, text)}
            // A row born from the ghost gets the keyboard straight away.
            autoFocus={i === options.length - 1 && opt === '' && options.length > 2}
            testID={`poll-option-input-${i}`}
          />
          <Pressable
            onPress={() => removeOption(i)}
            accessibilityRole="button"
            accessibilityLabel={`Remove option ${i + 1}`}
            hitSlop={8}
            testID={`poll-option-remove-${i}`}
          >
            <ThemedText variant="bodyStrong" color={colors.textFaint} style={styles.remove}>
              ✕
            </ThemedText>
          </Pressable>
        </View>
      ))}
      {options.length < MAX_POLL_OPTIONS ? (
        <Pressable
          onPress={() => onChange([...options, ''])}
          accessibilityRole="button"
          testID="poll-add-option"
          style={styles.ghostRow}
        >
          <ThemedText variant="body" color={colors.textFaint}>
            Add another…
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Question plus options — the create sheet's collapsed "Add a question to
 * vote on" section. The new-poll sheet renders its own screen-title question
 * and uses PollOptionsEditor directly.
 */
export function PollComposer({
  draft,
  onChange,
}: {
  draft: PollDraft;
  onChange: (draft: PollDraft) => void;
}) {
  return (
    <View style={styles.fields}>
      <TextInput
        style={styles.input}
        placeholder="Which film? Which bar?"
        placeholderTextColor={colors.textFaint}
        value={draft.question}
        onChangeText={(question) => onChange({ ...draft, question })}
        testID="poll-question-input"
      />
      <PollOptionsEditor
        options={draft.options}
        onChange={(options) => onChange({ ...draft, options })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fields: {
    gap: spacing.sm + 2,
  },
  input: {
    ...type.body,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    padding: 15,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    paddingHorizontal: 15,
    minHeight: 44,
  },
  optionInput: {
    ...type.body,
    flex: 1,
    paddingVertical: 15,
  },
  remove: {
    width: 20,
    textAlign: 'center',
  },
  ghostRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    padding: 15,
    minHeight: 44,
    justifyContent: 'center',
  },
});
