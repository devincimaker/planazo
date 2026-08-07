import { useState } from 'react';
import { View, StyleSheet, Pressable, Alert, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { inviteCodeFrom } from '../../lib/inviteCode';
import { requestedBlurb, requestedTitle } from '../../lib/groupDoor';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { GroupTiles } from './GroupTiles';
import { ThemedText, Button } from '../ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

/**
 * 16a: two ways in, and they're not equal — the link field is real,
 * creating is second, and the header pill stays gone.
 */
export function GroupsEmptyState() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [joinText, setJoinText] = useState('');

  const joinByCode = useMutation({
    mutationFn: async (code: string) => {
      // PLA-35: the code goes to the server, which resolves it and writes the
      // membership as 'member'. Resolving here and inserting separately meant
      // the database never saw proof the caller held the code — nor any say
      // in the role they arrived with.
      const { data, error } = await supabase.rpc('join_group_by_invite_code', { p_code: code });
      if (error) throw new Error(error.message);

      const result = data as { status: string; group_id?: string; name?: string };
      if (result.status === 'not_found') throw new Error('That link doesn’t work');
      if (result.status === 'already_member') throw new Error('You’re already in this group');
      return {
        status: result.status,
        id: result.group_id as string,
        name: result.name as string,
      };
    },
    onSuccess: (group) => {
      setJoinText('');
      // An approval door files a request instead of letting you in, so there
      // is no group to open yet. Same words whether this is a first ask or one
      // that was quietly turned down before (PLA-49).
      if (group.status === 'requested') {
        Alert.alert(requestedTitle(group.name), requestedBlurb());
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.push(`/(app)/group/${group.id}`);
    },
    onError: (error: Error) => Alert.alert('Couldn’t join', error.message),
  });

  const joinCode = inviteCodeFrom(joinText);

  return (
    <View style={styles.empty}>
      <GroupTiles />
      <ThemedText variant="headerTitle" style={styles.emptyTitle}>
        A group is just{'\n'}your group of people
      </ThemedText>
      <ThemedText variant="body" color={colors.textSecondary}>
        Flatmates, the padel lot, the ones who actually turn up. Plans you make go to one
        group, not to everybody.
      </ThemedText>

      <View style={styles.joinRow}>
        <TextInput
          style={styles.joinInput}
          placeholder="Paste an invite link"
          placeholderTextColor={colors.textFaint}
          value={joinText}
          onChangeText={setJoinText}
          autoCapitalize="none"
          autoCorrect={false}
          testID="join-input"
        />
        <Pressable
          accessibilityRole="button"
          disabled={!joinCode || joinByCode.isPending}
          onPress={() => joinCode && joinByCode.mutate(joinCode)}
          style={[styles.joinButton, joinCode ? styles.joinButtonReady : null]}
          testID="join-button"
        >
          <ThemedText
            variant="bodyStrong"
            color={joinCode ? colors.textOnAccent : colors.textFaint}
            style={styles.joinButtonLabel}
          >
            Join
          </ThemedText>
        </Pressable>
      </View>
      <View style={styles.orRow}>
        <View style={styles.orLine} />
        <ThemedText variant="caption" color={colors.textFaint}>
          or
        </ThemedText>
        <View style={styles.orLine} />
      </View>
      <Button
        label="Create a group"
        variant="ink"
        onPress={() => router.push('/(app)/group/new')}
        testID="create-group"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: 120,
    gap: spacing.sm,
  },
  emptyTitle: {
    paddingTop: spacing.xs,
  },
  joinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 20,
    // Half of what the Join button grew by comes back here, so the field
    // stays about the height it was (PLA-40).
    paddingVertical: spacing.xs,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    marginTop: spacing.lg,
  },
  joinInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  joinButton: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    // Was 34 (8 + 18 + 8) — the only way to act on a code you just typed.
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  joinButtonReady: {
    backgroundColor: colors.accent,
  },
  joinButtonLabel: {
    fontSize: 14,
    lineHeight: 18,
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: spacing.xxs,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.tabBarBorder,
  },
});
