import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { ThemedText, Card, Avatar } from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';
import { shareInviteLink } from './index';

export default function ManageGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const { data: group, isLoading } = useQuery({
    queryKey: ['group-manage', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select(
          `id, name, color, invite_code, anyone_can_post,
          group_members(user_id, role, notify_new_plans, joined_at,
            profile:profiles(display_name, avatar_url))`
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['group-manage', id] });
    queryClient.invalidateQueries({ queryKey: ['group', id] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  const setRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: 'admin' | 'member' }) => {
      const { error } = await supabase
        .from('group_members')
        .update({ role })
        .eq('group_id', id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const setAnyoneCanPost = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.from('groups').update({ anyone_can_post: on }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const setNotify = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.rpc('set_group_notify', {
        p_group_id: id,
        p_notify: on,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const leaveGroup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('leave_group', { p_group_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      router.navigate('/(app)/(tabs)/groups');
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  if (isLoading || !group) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const members = [...(group.group_members ?? [])].sort((a: any, b: any) =>
    (a.joined_at ?? '').localeCompare(b.joined_at ?? '')
  );
  const me = members.find((m: any) => m.user_id === user?.id);
  const others = members.filter((m: any) => m.user_id !== user?.id);
  const isAdmin = me?.role === 'admin';

  const confirmRemove = (m: any) =>
    Alert.alert(
      `Remove ${m.profile?.display_name}?`,
      'They drop out of this group’s plans too.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMember.mutate(m.user_id),
        },
      ]
    );

  const confirmLeave = () =>
    Alert.alert(`Leave ${group.name}?`, 'You’ll drop out of plans you said yes to.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveGroup.mutate() },
    ]);

  const roleChip = (m: any) => {
    const admin = m.role === 'admin';
    const chip = (
      <View style={[styles.roleChip, admin ? styles.roleChipAdmin : styles.roleChipMember]}>
        <ThemedText variant="tag" color={admin ? colors.background : colors.textSecondary}>
          {admin ? 'Admin' : 'Member'}
        </ThemedText>
      </View>
    );
    if (!isAdmin || m.user_id === user?.id) return chip;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setRole.mutate({ userId: m.user_id, role: admin ? 'member' : 'admin' })}
        testID={`role-${m.user_id}`}
      >
        {chip}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.navRow}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="back">
          <ThemedText variant="bodyStrong" color={colors.accent} numberOfLines={1}>
            ‹ {group.name}
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.navTitle}>Manage</ThemedText>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <ThemedText variant="sectionLabel">People</ThemedText>
            <Pressable
              onPress={() => shareInviteLink(group.name, group.invite_code)}
              accessibilityRole="button"
              testID="invite"
            >
              <ThemedText variant="bodyStrong" color={colors.accent}>
                Invite
              </ThemedText>
            </Pressable>
          </View>
          <Card padded={false}>
            {me ? (
              <View style={styles.personRow}>
                <Avatar name={me.profile?.display_name ?? '?'} size={36} imageUrl={me.profile?.avatar_url} />
                <View style={styles.personBody}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {me.profile?.display_name}{' '}
                    <ThemedText variant="bodyStrong" color={colors.textMuted}>
                      · you
                    </ThemedText>
                  </ThemedText>
                </View>
                {roleChip(me)}
              </View>
            ) : null}
            {others.map((m: any) => (
              <View key={m.user_id} style={[styles.personRow, styles.personDivider]}>
                <Avatar
                  name={m.profile?.display_name ?? '?'}
                  size={36}
                  imageUrl={m.profile?.avatar_url}
                />
                <View style={styles.personBody}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {m.profile?.display_name}
                  </ThemedText>
                  {isAdmin ? (
                    <Pressable
                      onPress={() => confirmRemove(m)}
                      accessibilityRole="button"
                      testID={`remove-${m.user_id}`}
                    >
                      <ThemedText variant="caption">Remove</ThemedText>
                    </Pressable>
                  ) : null}
                </View>
                {roleChip(m)}
              </View>
            ))}
          </Card>
        </View>

        <View style={styles.section}>
          <ThemedText variant="sectionLabel">How it runs</ThemedText>
          <Card padded={false}>
            <View style={styles.prefRow}>
              <View style={styles.prefBody}>
                <ThemedText variant="bodyStrong">Anyone can post plans</ThemedText>
                <ThemedText variant="caption">Off means only admins can</ThemedText>
              </View>
              <Switch
                value={!!group.anyone_can_post}
                disabled={!isAdmin || setAnyoneCanPost.isPending}
                onValueChange={(on) => setAnyoneCanPost.mutate(on)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                ios_backgroundColor={colors.borderStrong}
                testID="pref-anyone-can-post"
              />
            </View>
            <View style={[styles.prefRow, styles.personDivider]}>
              <View style={styles.prefBody}>
                <ThemedText variant="bodyStrong">Notify me on new plans</ThemedText>
                <ThemedText variant="caption">Push as soon as something lands</ThemedText>
              </View>
              <Switch
                value={!!me?.notify_new_plans}
                disabled={setNotify.isPending}
                onValueChange={(on) => setNotify.mutate(on)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                ios_backgroundColor={colors.borderStrong}
                testID="pref-notify"
              />
            </View>
            {isAdmin ? (
              <Pressable
                style={({ pressed }) => [
                  styles.prefRow,
                  styles.personDivider,
                  pressed && styles.rowPressed,
                ]}
                onPress={() => router.push(`/(app)/group/${id}/edit`)}
                accessibilityRole="button"
                testID="edit-group"
              >
                <ThemedText variant="bodyStrong">Rename or recolour</ThemedText>
                <ThemedText variant="body" color={colors.textFaint}>
                  ›
                </ThemedText>
              </Pressable>
            ) : null}
          </Card>
        </View>

        <View style={styles.leaveBlock}>
          <Pressable
            style={({ pressed }) => [styles.leaveCard, pressed && styles.rowPressed]}
            onPress={confirmLeave}
            accessibilityRole="button"
            testID="leave-group"
          >
            <ThemedText variant="bodyStrong" color={colors.accentPressed}>
              Leave {group.name}
            </ThemedText>
          </Pressable>
          <ThemedText variant="caption" style={styles.leaveNote}>
            You’ll drop out of plans you said yes to. Someone else keeps admin.
          </ThemedText>
        </View>
      </ScrollView>
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
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 10,
  },
  navTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  navSpacer: {
    width: 20,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 6,
    paddingBottom: 40,
    gap: spacing.xxl,
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  personDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  roleChip: {
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  roleChipAdmin: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  roleChipMember: {
    backgroundColor: colors.surfaceSunken,
    borderColor: colors.borderStrong,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    padding: spacing.lg,
  },
  prefBody: {
    flex: 1,
    gap: 3,
  },
  leaveBlock: {
    gap: spacing.sm,
    paddingBottom: 10,
  },
  leaveCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: spacing.lg,
    alignItems: 'center',
  },
  leaveNote: {
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
});
