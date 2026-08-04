import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../../lib/supabase';
import { contentViolation } from '../../../../lib/moderation';
import { insertPlanPoll, planPollKey } from '../../../../lib/usePlanPoll';
import {
  PollOptionsEditor,
  cleanPollDraft,
  emptyPollDraft,
  pollDraftValid,
} from '../../../../components/PollComposer';
import { ThemedText, Button } from '../../../../components/ui';
import { colors, fonts, spacing, type } from '../../../../theme/tokens';

/**
 * PLA-47 — "+ Add a poll" from the plan body, host only.
 *
 * The question is the title, written the way the plan's own title is
 * written. Below it, the options with a way back out of each, and a card
 * saying exactly how the vote will run: the people who are in, one pick
 * each, a tally that just runs. A poll added to a live plan announces
 * itself; one born with its plan (the create sheet's collapsed section)
 * rides the plan_created push instead.
 */
export default function NewPollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyPollDraft());

  // "The 5 who are in": the same population the vote predicate accepts —
  // yes-RSVPs on a fixed or locked plan, availability voters while the date
  // vote runs. Its own key, so it cannot clobber the detail screen's caches.
  const { data: peopleIn } = useQuery({
    queryKey: ['poll-people-in', id],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase
        .from('plans')
        .select('plan_type, status, rsvps(user_id, response), date_availability(user_id, available)')
        .eq('id', id)
        .single();
      if (error) throw error;
      const plan = data as unknown as {
        plan_type: string;
        status: string;
        rsvps: { user_id: string; response: string | null }[];
        date_availability: { user_id: string; available: boolean }[];
      };
      if (plan.plan_type === 'flexible' && plan.status === 'open') {
        return new Set(plan.date_availability.filter((a) => a.available).map((a) => a.user_id))
          .size;
      }
      return plan.rsvps.filter((r) => r.response === 'yes').length;
    },
    enabled: !!id,
  });

  const add = useMutation({
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
  const onTable = draft.options.filter((o) => o.trim().length > 0).length;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="cancel">
          <ThemedText variant="bodyStrong" color={colors.textMuted}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>New poll</ThemedText>
        <View style={styles.headerSpacer} />
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
          <View style={styles.titleBlock}>
            <TextInput
              style={styles.titleInput}
              placeholder="What's your question?"
              placeholderTextColor={colors.textFaint}
              value={draft.question}
              onChangeText={(question) => setDraft((d) => ({ ...d, question }))}
              autoFocus
              testID="poll-question-input"
            />
            <View style={styles.rule} />
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHead}>
              <ThemedText variant="sectionLabel">The options</ThemedText>
              {onTable > 0 ? (
                <ThemedText variant="caption" color={colors.accent}>
                  {onTable} on the table
                </ThemedText>
              ) : null}
            </View>
            <PollOptionsEditor
              options={draft.options}
              onChange={(options) => setDraft((d) => ({ ...d, options }))}
            />
          </View>

          <View style={styles.section}>
            <ThemedText variant="sectionLabel">How it works</ThemedText>
            <View style={styles.howCard}>
              <View style={styles.howRow}>
                <ThemedText variant="body">Who votes</ThemedText>
                <ThemedText variant="bodyStrong">
                  {peopleIn ? `The ${peopleIn} who are in` : 'The people who are in'}
                </ThemedText>
              </View>
              <View style={styles.howDivider} />
              <View style={styles.howRow}>
                <ThemedText variant="body">Each person picks</ThemedText>
                <ThemedText variant="bodyStrong">One</ThemedText>
              </View>
            </View>
            <ThemedText variant="caption" color={colors.textMuted} style={styles.hint}>
              Names show against every option, and nobody's stuck with their pick. The tally just
              runs. You decide when it's decided.
            </ThemedText>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            label={add.isPending ? 'Adding…' : 'Add the poll'}
            variant={valid ? 'primary' : 'secondary'}
            disabled={!valid || add.isPending}
            haptic={valid}
            onPress={() => add.mutate()}
            testID="ask"
          />
        </View>
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
    fontWeight: '700',
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 48,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: 40,
    gap: 22,
  },
  titleBlock: {
    gap: 10,
  },
  titleInput: {
    ...type.screenTitle,
    padding: 0,
  },
  rule: {
    height: 2,
    backgroundColor: colors.borderStrong,
  },
  section: {
    gap: 10,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  howCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    overflow: 'hidden',
  },
  howRow: {
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  howDivider: {
    height: 1,
    backgroundColor: colors.divider,
    marginHorizontal: spacing.lg,
  },
  hint: {
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
