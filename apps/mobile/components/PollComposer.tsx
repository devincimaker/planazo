import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText } from './ui/ThemedText';
import { colors, radii, spacing, type } from '../theme/tokens';

/**
 * PLA-48 opens the option list to the whole group; until then a question is a
 * short host-written list, and six is already generous for one.
 */
export const MAX_POLL_OPTIONS = 6;

export interface PollDraft {
  question: string;
  options: string[];
}

export const emptyPollDraft = (): PollDraft => ({ question: '', options: ['', ''] });

/** Trimmed, blanks dropped — what actually gets inserted. */
export function cleanPollDraft(draft: PollDraft): { question: string; options: string[] } {
  return {
    question: draft.question.trim(),
    options: draft.options.map((o) => o.trim()).filter(Boolean),
  };
}

/** A question with fewer than two real options is not a question. */
export function pollDraftValid(draft: PollDraft): boolean {
  const { question, options } = cleanPollDraft(draft);
  return question.length > 0 && options.length >= 2 && new Set(options).size === options.length;
}

/** Anything typed at all — the create sheet must not post half a question. */
export function pollDraftTouched(draft: PollDraft): boolean {
  return draft.question.trim().length > 0 || draft.options.some((o) => o.trim().length > 0);
}

interface Props {
  draft: PollDraft;
  onChange: (draft: PollDraft) => void;
  autoFocus?: boolean;
}

/**
 * The question-and-options form, shared by the create sheet's collapsed
 * "Add a question" section and the host menu's ask screen (PLA-47). Purely
 * controlled: whoever mounts it owns the draft and decides when it becomes
 * rows.
 */
export function PollComposer({ draft, onChange, autoFocus = false }: Props) {
  const setQuestion = (question: string) => onChange({ ...draft, question });
  const setOption = (i: number, text: string) =>
    onChange({ ...draft, options: draft.options.map((o, j) => (j === i ? text : o)) });
  const addOption = () => onChange({ ...draft, options: [...draft.options, ''] });

  return (
    <View style={styles.fields}>
      <TextInput
        style={styles.input}
        placeholder="Which film? Which bar?"
        placeholderTextColor={colors.textFaint}
        value={draft.question}
        onChangeText={setQuestion}
        autoFocus={autoFocus}
        testID="poll-question-input"
      />
      {draft.options.map((opt, i) => (
        <TextInput
          key={i}
          style={styles.input}
          placeholder={`Option ${i + 1}`}
          placeholderTextColor={colors.textFaint}
          value={opt}
          onChangeText={(text) => setOption(i, text)}
          testID={`poll-option-input-${i}`}
        />
      ))}
      {draft.options.length < MAX_POLL_OPTIONS ? (
        <Pressable
          onPress={addOption}
          accessibilityRole="button"
          testID="poll-add-option"
          style={styles.addRow}
        >
          <ThemedText variant="bodyStrong" color={colors.accent}>
            + Another option
          </ThemedText>
        </Pressable>
      ) : null}
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
  addRow: {
    paddingVertical: spacing.xs,
  },
});
