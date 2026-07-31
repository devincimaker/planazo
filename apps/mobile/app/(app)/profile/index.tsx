import { Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { supabase } from '../../../lib/supabase';
import { clearPushToken, registerPushToken } from '../../../lib/push';
import { purgeOwnedFiles } from '../../../lib/storage';
import { useAuthStore } from '../../../stores/authStore';
import { Avatar, Card, ListRow, ThemedText } from '../../../components/ui';
import { colors, fonts, spacing } from '../../../theme/tokens';

/**
 * 12b — the profile sheet, opened from the feed avatar. Read-only by design:
 * the one outlined button is the only way into editing, so no tap in this
 * sheet can change anything by accident.
 */
export default function ProfileSheet() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, profile, setProfile, logout } = useAuthStore();

  const { data: groupCount } = useQuery({
    queryKey: ['profile-group-count', user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('group_members')
        .select('group_id', { count: 'exact', head: true })
        .eq('user_id', user!.id);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
  });

  const setCalendar = useMutation({
    mutationFn: async (on: boolean) => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ add_to_calendar: on })
        .eq('id', profile!.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => setProfile(data),
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const setPush = useMutation({
    mutationFn: async (on: boolean) => {
      // The privacy policy says turning notifications off clears the device
      // token, so do that rather than only flipping a flag — otherwise the
      // token sits on the profile and the policy is a lie. Token first, so
      // the row we read back already reflects it.
      if (on) {
        await registerPushToken(profile!.id);
      } else {
        await clearPushToken(profile!.id);
      }

      const { data, error } = await supabase
        .from('profiles')
        .update({ push_enabled: on })
        .eq('id', profile!.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => setProfile(data),
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const confirmSignOut = () => {
    Alert.alert('Sign out', 'You can sign back in any time.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            if (user) await clearPushToken(user.id);
          } catch {
            // best-effort — never block sign-out
          }
          await supabase.auth.signOut();
          queryClient.clear();
          logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const deleteAccount = useMutation({
    mutationFn: async () => {
      // Files first, while this session is still the owner RLS recognises.
      // The database cannot reach Storage, so if this does not happen here it
      // does not happen at all — and the avatars bucket is public.
      if (user) await purgeOwnedFiles(user.id);

      const { error } = await supabase.rpc('delete_my_account');
      if (error) throw error;
    },
    onSuccess: async () => {
      // The account is already gone, so the token this session holds is dead —
      // sign out locally rather than asking a server that will refuse.
      await supabase.auth.signOut({ scope: 'local' });
      queryClient.clear();
      logout();
      router.replace('/(auth)/login');
    },
    onError: (error: Error) => Alert.alert("Couldn't delete your account", error.message),
  });

  // Two taps, because there is no undo and no support inbox that can put it
  // back. App Store Review 5.1.1(v) wants this reachable, not hidden.
  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      'Your profile, your photo and every answer you gave go for good. Groups you started pass to whoever has been in them longest.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            Alert.alert('Last check', "There's no way back from this one.", [
              { text: 'Keep my account', style: 'cancel' },
              {
                text: 'Delete for good',
                style: 'destructive',
                onPress: () => deleteAccount.mutate(),
              },
            ]),
        },
      ],
    );
  };

  const subtitle = [
    profile?.handle ? `@${profile.handle}` : null,
    groupCount != null ? `in ${groupCount} ${groupCount === 1 ? 'group' : 'groups'}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const version = Constants.expoConfig?.version;

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <View style={styles.grabber} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} bounces={false}>
        <View style={styles.identity}>
          <Avatar
            name={profile?.display_name ?? '?'}
            dark
            size={62}
            imageUrl={profile?.avatar_url}
            testID="profile-avatar"
          />
          <View style={styles.identityText}>
            <ThemedText style={styles.name} numberOfLines={1}>
              {profile?.display_name}
            </ThemedText>
            {subtitle ? (
              <ThemedText variant="sub" color={colors.textMuted} numberOfLines={1}>
                {subtitle}
              </ThemedText>
            ) : null}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(app)/profile/edit')}
          style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
          testID="edit-profile"
        >
          <ThemedText variant="bodyStrong">Edit name & photo</ThemedText>
        </Pressable>

        <Card padded={false}>
          <ListRow
            title="Notify me"
            right={
              <Switch
                value={!!profile?.push_enabled}
                disabled={setPush.isPending}
                onValueChange={(on) => setPush.mutate(on)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                ios_backgroundColor={colors.borderStrong}
                testID="pref-push"
              />
            }
          />
          <ListRow
            title="Add to my calendar"
            divider
            right={
              <Switch
                value={!!profile?.add_to_calendar}
                disabled={setCalendar.isPending}
                onValueChange={(on) => setCalendar.mutate(on)}
                trackColor={{ false: colors.borderStrong, true: colors.accent }}
                ios_backgroundColor={colors.borderStrong}
                testID="pref-calendar"
              />
            }
          />
          <ListRow title="Account" value={profile?.email} divider />
          {/* right: design 12b's sign-out row has no chevron */}
          <ListRow
            title="Sign out"
            destructive
            divider
            onPress={confirmSignOut}
            right={<></>}
            testID="sign-out"
          />
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/(app)/feedback')}
          style={({ pressed }) => [styles.feedback, pressed && styles.pressed]}
          testID="send-feedback"
        >
          <View style={styles.feedbackText}>
            <ThemedText variant="bodyStrong">Send feedback</ThemedText>
            <ThemedText variant="caption">Broken thing, or an idea — takes 10 seconds</ThemedText>
          </View>
          <ThemedText variant="body" color={colors.accent}>
            ›
          </ThemedText>
        </Pressable>

        {/* Deliberately down here rather than beside "Sign out": the two read
            alike in a hurry, and only one of them is recoverable. */}
        <Pressable
          accessibilityRole="button"
          disabled={deleteAccount.isPending}
          onPress={confirmDelete}
          style={({ pressed }) => [styles.deleteAccount, pressed && styles.pressed]}
          testID="delete-account"
        >
          <ThemedText
            variant="caption"
            color={deleteAccount.isPending ? colors.textFaint : colors.accentPressed}
          >
            {deleteAccount.isPending ? 'Deleting…' : 'Delete my account'}
          </ThemedText>
        </Pressable>

        {version ? (
          <ThemedText variant="caption" color={colors.textFaint} style={styles.version}>
            Planazo {version}
          </ThemedText>
        ) : null}
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
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: 10,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: 30,
    gap: 18,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 2,
  },
  identityText: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  name: {
    fontFamily: fonts.displayHeavy,
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: -0.48,
    color: colors.textPrimary,
  },
  editButton: {
    paddingVertical: 14,
    borderRadius: 16,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.accent,
    borderRadius: 20,
    paddingVertical: 15,
    paddingHorizontal: spacing.lg,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  feedbackText: {
    flex: 1,
    gap: 2,
  },
  deleteAccount: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  version: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
