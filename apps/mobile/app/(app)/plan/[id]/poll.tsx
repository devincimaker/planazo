import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { contentViolation } from '../../../../lib/moderation';
import { insertPlanPoll, planPollKey } from '../../../../lib/usePlanPoll';
import {
  PollComposer,
  cleanPollDraft,
  emptyPollDraft,
  pollDraftValid,
} from '../../../../components/PollComposer';
import { ThemedText } from '../../../../components/ui';
import { colors, fonts, spacing } from '../../../../theme/tokens';

/**
 * PLA-47 — the host menu's "Ask the group something".
 *
 * The question that only becomes a question after the plan exists: cinema was
 * posted on Sunday, the film argument started on Monday. The create sheet
 * covers the host who knew from the start; this covers everyone else, and it
 * is the path that announces itself (a poll born with its plan rides along
 * with the plan_created push instead).
 */
export default function AskPollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyPollDraft());

  const ask = useMutation({
    mutationFn: async () => {
      const { question, options } = cleanPollDraft(draft);
      // Guideline 1.2: objectionable language stops here, not in review.
      const violation = contentViolation({
        question,
        option: options.join(' '),
      });
      if (violation) throw new Error(violation);

      await insertPlanPoll(String(id), question, options);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: planPollKey(String(id)) });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      router.back();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const valid = pollDraftValid(draft);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="cancel">
          <ThemedText variant="bodyStrong" color={colors.textMuted}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Ask the group</ThemedText>
        <Pressable
          onPress={() => ask.mutate()}
          disabled={!valid || ask.isPending}
          accessibilityRole="button"
          testID="ask"
        >
          <ThemedText variant="bodyStrong" color={valid ? colors.accent : colors.textFaint}>
            Ask
          </ThemedText>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <ThemedText variant="sectionLabel">Still to decide</ThemedText>
            <PollComposer draft={draft} onChange={setDraft} autoFocus />
          </View>

          <ThemedText variant="caption" color={colors.textMuted} style={styles.hint}>
            Everyone in the group gets asked and can pick one. You close the vote when it's
            settled, and the answer lands on the plan.
          </ThemedText>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 40,
    gap: 22,
  },
  section: {
    gap: 10,
  },
  hint: {
    fontFamily: fonts.body,
    lineHeight: 19,
  },
});
