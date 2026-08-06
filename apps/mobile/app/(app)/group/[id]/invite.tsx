import { useState } from 'react';
import { View, ScrollView, StyleSheet, Pressable, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { supabase } from '../../../../lib/supabase';
import { useFriends } from '../../../../lib/useFriends';
import { inviteLinkFor } from '../../../../lib/inviteCode';
import { MIN_TOUCH_TARGET } from '../../../../lib/a11y';
import { ThemedText, Avatar, Button } from '../../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../../theme/tokens';
import { shareInviteLink } from './index';

export default function InviteToGroupSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [picks, setPicks] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const { friends } = useFriends();

  const { data: group } = useQuery({
    queryKey: ['group-invite-sheet', id],
    queryFn: async () => {
      const [groupRes, invitesRes] = await Promise.all([
        supabase
          .from('groups')
          .select('id, name, invite_code, group_members(user_id)')
          .eq('id', id)
          .single(),
        supabase
          .from('group_invites')
          .select('invitee_id')
          .eq('group_id', id)
          .eq('status', 'pending'),
      ]);
      if (groupRes.error) throw groupRes.error;
      if (invitesRes.error) throw invitesRes.error;
      return {
        ...(groupRes.data as any),
        pendingInviteeIds: invitesRes.data.map((i: any) => i.invitee_id),
      };
    },
    enabled: !!id,
  });

  const memberIds = new Set((group?.group_members ?? []).map((m: any) => m.user_id));
  const invitedIds = new Set(group?.pendingInviteeIds ?? []);
  const invitable = friends.filter((f) => !memberIds.has(f.id));
  const link = group ? inviteLinkFor(group.invite_code) : '';

  const copyLink = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
  };

  const sendInvites = useMutation({
    mutationFn: async () => {
      await Promise.all(
        picks.map((invitee) =>
          supabase.rpc('invite_to_group', { p_group_id: id, p_invitee: invitee })
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-invite-sheet', id] });
      router.back();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const togglePick = (personId: string) =>
    setPicks((prev) =>
      prev.includes(personId) ? prev.filter((p) => p !== personId) : [...prev, personId]
    );

  return (
    <SafeAreaView style={styles.screen} edges={[]}>
      <View style={styles.grabber} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        <View style={styles.titleBlock}>
          <ThemedText variant="headerTitle">Add people to {group?.name ?? '…'}</ThemedText>
          <ThemedText variant="body" color={colors.textSecondary}>
            Anyone with the link joins straight away.
          </ThemedText>
        </View>

        <View style={styles.linkCard}>
          <ThemedText style={styles.link}>{link}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={copyLink}
            style={[styles.copyButton, copied && styles.copyButtonDone]}
            testID="copy-link"
          >
            <ThemedText
              variant="bodyStrong"
              color={copied ? colors.confirmed : colors.background}
            >
              {copied ? 'Link copied ✓' : 'Copy link'}
            </ThemedText>
          </Pressable>
        </View>

        {invitable.length > 0 ? (
          <View style={styles.section}>
            <ThemedText variant="sectionLabel">Already on Planazo</ThemedText>
            <View style={styles.chipWrap}>
              {invitable.map((f) => {
                const invited = invitedIds.has(f.id);
                const picked = picks.includes(f.id);
                return (
                  <Pressable
                    key={f.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: picked, disabled: invited }}
                    disabled={invited}
                    onPress={() => togglePick(f.id)}
                    style={[
                      styles.chip,
                      picked && styles.chipPicked,
                      invited && styles.chipInvited,
                    ]}
                    testID={`invitee-${f.id}`}
                  >
                    <Avatar name={f.name} size={26} imageUrl={f.avatarUrl} />
                    <ThemedText
                      variant="bodyStrong"
                      color={
                        picked
                          ? colors.background
                          : invited
                            ? colors.textFaint
                            : colors.textPrimary
                      }
                      style={styles.chipLabel}
                    >
                      {f.name.split(' ')[0]}
                    </ThemedText>
                    <ThemedText
                      variant="tag"
                      color={picked ? colors.background : colors.textFaint}
                    >
                      {invited ? 'invited' : picked ? '✓' : '+'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {picks.length > 0 ? (
          <Button
            label={
              sendInvites.isPending
                ? 'Sending…'
                : `Send ${picks.length} invite${picks.length === 1 ? '' : 's'}`
            }
            disabled={sendInvites.isPending}
            onPress={() => sendInvites.mutate()}
            testID="send-invites"
          />
        ) : (
          <Button
            label="Share the link instead"
            variant="secondary"
            onPress={() => group && shareInviteLink(group.name, group.invite_code)}
            testID="share-link"
          />
        )}
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
    width: 44,
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
    gap: spacing.xl,
  },
  titleBlock: {
    gap: 6,
  },
  linkCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  link: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.19,
    color: colors.textPrimary,
  },
  copyButton: {
    backgroundColor: colors.ink,
    borderRadius: radii.input,
    paddingVertical: 14,
    alignItems: 'center',
  },
  copyButtonDone: {
    backgroundColor: colors.confirmedSoft,
  },
  section: {
    gap: 10,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  // 36 (7 + 19 + 7 + border) — one tap per person you are inviting (PLA-40).
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radii.pill,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 13,
  },
  chipPicked: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  chipInvited: {
    opacity: 0.6,
  },
  chipLabel: {
    fontSize: 15,
    lineHeight: 19,
  },
});
