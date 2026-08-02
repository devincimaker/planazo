import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../../../lib/supabase';
import { ThemedText, Button } from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';

/**
 * 20b — the confirm, with a reason. Not an OS alert, because it has a job an
 * alert can't do: collect the reason the cancelled screen and the push both
 * carry. Optional but pre-focused — typing is the path of least resistance.
 */
export default function CancelPlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [focused, setFocused] = useState(false);

  // Warm from the detail screen's cache. These share query keys with the
  // detail screen, so the selects must match its shapes exactly — a slimmer
  // select here would clobber the detail's cached joins.
  const { data: plan } = useQuery({
    queryKey: ['plan', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select(
          '*, creator:profiles!plans_created_by_fkey(display_name), canceller:profiles!plans_cancelled_by_fkey(display_name), groups(id, name, color)'
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const { data: rsvps } = useQuery({
    queryKey: ['plan-rsvps', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rsvps')
        .select('*, profile:profiles(display_name)')
        .eq('plan_id', id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id,
  });

  const { data: availabilities } = useQuery({
    queryKey: ['plan-availabilities', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('date_availability')
        .select('*, profile:profiles(display_name)')
        .eq('plan_id', id);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const cancelPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_plan', {
        p_plan_id: id,
        p_reason: reason.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      if (plan?.group_id) {
        queryClient.invalidateQueries({ queryKey: ['group-plans', plan.group_id] });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      router.back();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  // The cost, named out loud: who this lands on.
  const openFlexible = plan?.plan_type === 'flexible' && plan?.status === 'open';
  const affected = openFlexible
    ? new Set((availabilities ?? []).map((a) => a.user_id)).size
    : (rsvps ?? []).filter((r) => r.response === 'yes').length;
  const costLine =
    affected === 0
      ? 'No one has answered yet. The plan moves to Past.'
      : affected === 1
        ? `1 person ${openFlexible ? 'sent dates' : "said they're coming"}. They'll get a notification straight away, and the plan moves to Past.`
        : `${affected} people ${openFlexible ? 'sent dates' : "said they're coming"}. They'll all get a notification straight away, and the plan moves to Past.`;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.sheet}>
        <View style={styles.grabber} />

        <View style={styles.headerBlock}>
          <ThemedText variant="headerTitle">
            Call off {plan ? `“${plan.title}”` : 'this plan'}?
          </ThemedText>
          <ThemedText variant="body" color={colors.textSecondary}>
            {costLine}
          </ThemedText>
        </View>

        <View style={styles.reasonBlock}>
          <ThemedText variant="sectionLabel">
            Say why{' '}
            <ThemedText variant="caption" color={colors.textFaint} style={styles.optional}>
              (optional)
            </ThemedText>
          </ThemedText>
          <TextInput
            style={[styles.input, focused && styles.inputFocused]}
            value={reason}
            onChangeText={setReason}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            multiline
            autoFocus
            selectionColor={colors.accent}
            testID="cancel-reason"
          />
          <ThemedText variant="caption" color={colors.textMuted} style={styles.hint}>
            This goes in the notification and stays on the plan.
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <Button
            label="Call it off"
            variant="danger"
            onPress={() => cancelPlan.mutate()}
            disabled={cancelPlan.isPending}
            testID="confirm-cancel"
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={styles.keepIt}
            testID="keep-it"
          >
            <ThemedText variant="body" color={colors.textSecondary} style={styles.keepItLabel}>
              Keep it
            </ThemedText>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  sheet: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.endedBorder,
    alignSelf: 'center',
    marginBottom: spacing.xxs,
  },
  headerBlock: {
    gap: 7,
  },
  reasonBlock: {
    gap: spacing.sm,
  },
  optional: {
    textTransform: 'none',
    letterSpacing: 0,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radii.input + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    minHeight: 74,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  inputFocused: {
    borderColor: colors.accent,
  },
  hint: {
    fontFamily: fonts.body,
  },
  actions: {
    gap: spacing.sm + 1,
    paddingBottom: spacing.lg,
  },
  keepIt: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  keepItLabel: {
    fontFamily: fonts.bodyBold,
  },
});
