import { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../stores/authStore';
import { useFriends } from '../../lib/useFriends';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, Card, Avatar } from '../../components/ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

interface PersonRow {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  note: string | null;
}

type Relation = 'friend' | 'requested' | 'incoming' | 'none';

export default function FindPeopleScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [query, setQuery] = useState('');
  // Requests fired from this screen, so Add flips in place without a refetch
  const [sentTo, setSentTo] = useState<Record<string, true>>({});

  const { friends } = useFriends();
  const friendIds = useMemo(() => new Set(friends.map((f) => f.id)), [friends]);

  const { data: pending } = useQuery({
    queryKey: ['friendships-pending', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('friendships')
        .select('requester_id, addressee_id, status')
        .eq('status', 'pending')
        .or(`requester_id.eq.${user?.id},addressee_id.eq.${user?.id}`);
      if (error) throw error;
      const outgoing = new Set<string>();
      const incoming = new Set<string>();
      (data ?? []).forEach((f: any) => {
        if (f.requester_id === user?.id) outgoing.add(f.addressee_id);
        else incoming.add(f.requester_id);
      });
      return { outgoing, incoming };
    },
    enabled: !!user,
  });

  // Everyone I share a group with, with the group's name for "both in X"
  const { data: sharedPeople } = useQuery({
    queryKey: ['shared-people', user?.id],
    queryFn: async (): Promise<PersonRow[]> => {
      const { data, error } = await supabase
        .from('group_members')
        .select(
          `group_id,
          groups:group_id(name, group_members(user_id, profile:profiles(id, display_name, handle, avatar_url)))`
        )
        .eq('user_id', user!.id);
      if (error) throw error;

      const seen = new Map<string, PersonRow>();
      (data ?? []).forEach((row: any) => {
        (row.groups?.group_members ?? []).forEach((m: any) => {
          const p = m.profile;
          if (!p || p.id === user?.id || seen.has(p.id)) return;
          seen.set(p.id, {
            id: p.id,
            name: p.display_name,
            handle: p.handle,
            avatarUrl: p.avatar_url,
            note: `both in ${row.groups.name}`,
          });
        });
      });
      return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!user,
  });

  const cleanQuery = query.trim().replace(/[%,()]/g, '');
  const { data: results } = useQuery({
    queryKey: ['people-search', cleanQuery],
    queryFn: async (): Promise<PersonRow[]> => {
      // Server-side on purpose: the results must omit anyone who blocked this
      // user, and that list is exactly what RLS keeps the client from reading.
      const { data, error } = await supabase.rpc('search_people', {
        p_query: cleanQuery,
      });
      if (error) throw error;
      const sharedNote = new Map((sharedPeople ?? []).map((p) => [p.id, p.note]));
      return (data ?? []).map((p: any) => ({
        id: p.id,
        name: p.display_name,
        handle: p.handle,
        avatarUrl: p.avatar_url,
        note: sharedNote.get(p.id) ?? null,
      }));
    },
    enabled: !!user && cleanQuery.length >= 2,
  });

  const sendRequest = useMutation({
    mutationFn: async (personId: string) => {
      const { data, error } = await supabase.rpc('send_friend_request', {
        p_addressee: personId,
      });
      if (error) throw error;
      return { personId, status: data?.status };
    },
    onSuccess: ({ personId, status }) => {
      // The one status that should not flip Add to Requested: the block is the
      // caller's own, so the answer is honest and actionable.
      if (status === 'you_blocked_them') {
        Alert.alert(
          'You blocked them',
          'Unblock them first, from Blocked people in your profile.',
        );
        return;
      }
      setSentTo((prev) => ({ ...prev, [personId]: true }));
      // A crossing request auto-accepts: refresh friends and the invites badge
      if (status === 'accepted') {
        queryClient.invalidateQueries({ queryKey: ['friends'] });
        queryClient.invalidateQueries({ queryKey: ['invites'] });
        queryClient.invalidateQueries({ queryKey: ['friendships-pending'] });
      }
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  const relationOf = (id: string): Relation => {
    if (friendIds.has(id)) return 'friend';
    if (sentTo[id] || pending?.outgoing.has(id)) return 'requested';
    if (pending?.incoming.has(id)) return 'incoming';
    return 'none';
  };

  const renderAction = (person: PersonRow) => {
    const relation = relationOf(person.id);
    if (relation === 'friend') {
      return (
        <View style={[styles.pill, styles.pillMuted]}>
          <ThemedText variant="bodyStrong" color={colors.textMuted} style={styles.pillLabel}>
            Friends
          </ThemedText>
        </View>
      );
    }
    if (relation === 'requested') {
      return (
        <View style={[styles.pill, styles.pillMuted]} testID={`requested-${person.id}`}>
          <ThemedText variant="bodyStrong" color={colors.textMuted} style={styles.pillLabel}>
            Requested
          </ThemedText>
        </View>
      );
    }
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => sendRequest.mutate(person.id)}
        style={({ pressed }) => [styles.pill, styles.pillAdd, pressed && styles.pressed]}
        testID={`add-${person.id}`}
      >
        <ThemedText variant="bodyStrong" color={colors.textOnAccent} style={styles.pillLabel}>
          {relation === 'incoming' ? 'Accept' : 'Add'}
        </ThemedText>
      </Pressable>
    );
  };

  const renderRows = (people: PersonRow[]) => (
    <Card padded={false}>
      {people.map((p, i) => (
        <View key={p.id} style={[styles.personRow, i > 0 && styles.divider]}>
          <Avatar name={p.name} size={42} imageUrl={p.avatarUrl} />
          <View style={styles.personBody}>
            <ThemedText variant="bodyStrong" style={styles.personName} numberOfLines={1}>
              {p.name}
            </ThemedText>
            <ThemedText variant="caption" numberOfLines={1}>
              {p.handle ? `@${p.handle}` : ''}
              {p.handle && p.note ? ' · ' : ''}
              {p.note ?? ''}
            </ThemedText>
          </View>
          {renderAction(p)}
        </View>
      ))}
    </Card>
  );

  const searching = cleanQuery.length >= 2;
  // Keep just-requested people visible — Add becomes Requested in place (17b)
  const suggestions = (sharedPeople ?? []).filter((p) => relationOf(p.id) !== 'friend');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.navRow}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          testID="back"
          style={styles.backAction}
        >
          <ThemedText style={styles.backChevron}>‹</ThemedText>
        </Pressable>
        <ThemedText style={styles.navTitle}>Find people</ThemedText>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <View style={styles.searchIcon}>
            <View style={styles.searchCircle} />
            <View style={styles.searchHandle} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Name or @handle"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            testID="search-input"
          />
        </View>
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {searching ? (
          <View style={styles.section}>
            <ThemedText variant="sectionLabel">Results</ThemedText>
            {(results ?? []).length === 0 ? (
              <ThemedText variant="sub">No one by that name or handle yet.</ThemedText>
            ) : (
              renderRows(results ?? [])
            )}
          </View>
        ) : (
          <>
            {suggestions.length > 0 ? (
              <View style={styles.section}>
                <ThemedText variant="sectionLabel">You've planned together</ThemedText>
                {renderRows(suggestions)}
              </View>
            ) : null}

            {friends.length > 0 ? (
              <View style={styles.section}>
                <ThemedText variant="sectionLabel">Your people</ThemedText>
                {renderRows(
                  friends.map((f) => ({
                    id: f.id,
                    name: f.name,
                    handle: f.handle,
                    avatarUrl: f.avatarUrl,
                    note: null,
                  }))
                )}
              </View>
            ) : null}
          </>
        )}

        <ThemedText variant="caption" color={colors.textFaint} style={styles.footnote}>
          People can only find you by your name or @handle. Your plans and groups stay hidden
          until you accept.
        </ThemedText>
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
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 10,
  },
  // The chevron glyph is about 10×26 — the smallest thing anyone is asked to
  // hit. The box around it is a real 44×44; the negative margins give back
  // every point it added, so the chevron stays put, the title beside it does
  // not shift, and the row keeps its height (PLA-40).
  backAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -(MIN_TOUCH_TARGET - 26) / 2,
    marginHorizontal: -(MIN_TOUCH_TARGET - 10) / 2,
  },
  backChevron: {
    fontSize: 22,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  navTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  searchWrap: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 14,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.ink,
    borderRadius: radii.input,
    paddingHorizontal: 15,
  },
  searchIcon: {
    width: 15,
    height: 14,
  },
  searchCircle: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 11,
    height: 11,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
  },
  searchHandle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 8,
    height: 2,
    backgroundColor: colors.textMuted,
    transform: [{ rotate: '45deg' }],
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 13,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingBottom: 40,
    gap: spacing.xl,
  },
  section: {
    gap: 10,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personBody: {
    flex: 1,
    gap: spacing.xxs,
  },
  personName: {
    fontSize: 16,
    lineHeight: 20,
  },
  // 38 (9 + 20 + 9) — "Add" is the whole point of this screen. The person row
  // around it is 60+, so this grows into space it already had (PLA-40).
  pill: {
    borderRadius: radii.pill,
    paddingVertical: 9,
    paddingHorizontal: 16,
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
  },
  pillAdd: {
    backgroundColor: colors.accent,
  },
  pillMuted: {
    backgroundColor: colors.surfaceSunken,
  },
  pillLabel: {
    fontSize: 14,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.8,
  },
  footnote: {
    lineHeight: 18,
  },
});
