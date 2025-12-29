import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { COLORS } from '../../../../constants/colors';
import type { GroupMemberWithProfile } from '@planazo/shared';

export default function MembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useQuery({
    queryKey: ['group-members', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          *,
          profile:profiles(*)
        `)
        .eq('group_id', id)
        .order('role', { ascending: true });

      if (error) throw error;
      return data as GroupMemberWithProfile[];
    },
    enabled: !!id,
  });

  const { data: currentMembership } = useQuery({
    queryKey: ['group-membership', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', id)
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id && !!user,
  });

  const isAdmin = currentMembership?.role === 'admin';

  const kickMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('id', memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-members', id] });
      queryClient.invalidateQueries({ queryKey: ['group-member-count', id] });
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const changeRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: 'admin' | 'member' }) => {
      const { error } = await supabase
        .from('group_members')
        .update({ role })
        .eq('id', memberId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-members', id] });
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  function handleMemberPress(member: GroupMemberWithProfile) {
    if (!isAdmin || member.user_id === user?.id) return;

    const options = [];

    if (member.role === 'member') {
      options.push({
        text: 'Make Admin',
        onPress: () => changeRole.mutate({ memberId: member.id, role: 'admin' }),
      });
    } else {
      options.push({
        text: 'Remove Admin',
        onPress: () => changeRole.mutate({ memberId: member.id, role: 'member' }),
      });
    }

    options.push({
      text: 'Remove from Group',
      style: 'destructive' as const,
      onPress: () => {
        Alert.alert(
          'Remove Member',
          `Remove ${member.profile.display_name} from the group?`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => kickMember.mutate(member.id),
            },
          ]
        );
      },
    });

    options.push({ text: 'Cancel', style: 'cancel' as const });

    Alert.alert(member.profile.display_name, undefined, options);
  }

  const admins = members?.filter((m) => m.role === 'admin') || [];
  const regularMembers = members?.filter((m) => m.role === 'member') || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {admins.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Admins</Text>
          {admins.map((member) => (
            <TouchableOpacity
              key={member.id}
              style={styles.memberCard}
              onPress={() => handleMemberPress(member)}
              disabled={!isAdmin || member.user_id === user?.id}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {member.profile.display_name[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {member.profile.display_name}
                  {member.user_id === user?.id && ' (You)'}
                </Text>
                <Text style={styles.memberEmail}>{member.profile.email}</Text>
              </View>
              <View style={styles.adminBadge}>
                <Text style={styles.adminBadgeText}>Admin</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {regularMembers.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members</Text>
          {regularMembers.map((member) => (
            <TouchableOpacity
              key={member.id}
              style={styles.memberCard}
              onPress={() => handleMemberPress(member)}
              disabled={!isAdmin}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {member.profile.display_name[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.memberInfo}>
                <Text style={styles.memberName}>
                  {member.profile.display_name}
                  {member.user_id === user?.id && ' (You)'}
                </Text>
                <Text style={styles.memberEmail}>{member.profile.email}</Text>
              </View>
              {isAdmin && member.user_id !== user?.id && (
                <Text style={styles.chevron}>›</Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {!isLoading && members?.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No members found</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  memberCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    marginBottom: 2,
  },
  memberEmail: {
    fontSize: 14,
    color: COLORS.gray[500],
  },
  adminBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  adminBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  chevron: {
    fontSize: 24,
    color: COLORS.gray[400],
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray[500],
  },
});
