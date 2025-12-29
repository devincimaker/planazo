import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { COLORS } from '../../../constants/colors';
import type { GroupWithMemberCount } from '@planazo/shared';

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function GroupsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [joinCode, setJoinCode] = useState('');

  const { data: groups, isLoading, refetch } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select(`
          group_id,
          role,
          groups:group_id (
            id,
            name,
            description,
            invite_code,
            created_by,
            created_at
          )
        `)
        .eq('user_id', user?.id);

      if (error) throw error;

      // Get member counts
      const groupIds = data.map((d) => d.group_id);
      const { data: counts } = await supabase
        .from('group_members')
        .select('group_id')
        .in('group_id', groupIds);

      const countMap: Record<string, number> = {};
      counts?.forEach((c) => {
        countMap[c.group_id] = (countMap[c.group_id] || 0) + 1;
      });

      return data.map((d) => ({
        ...(d.groups as any),
        member_count: countMap[d.group_id] || 0,
        role: d.role,
      })) as (GroupWithMemberCount & { role: string })[];
    },
    enabled: !!user,
  });

  const createGroup = useMutation({
    mutationFn: async () => {
      const inviteCode = generateInviteCode();

      // Create group
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          invite_code: inviteCode,
          created_by: user?.id,
        })
        .select()
        .single();

      if (groupError) throw groupError;

      // Add creator as admin
      const { error: memberError } = await supabase
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: user?.id,
          role: 'admin',
        });

      if (memberError) throw memberError;

      return group;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setShowCreateModal(false);
      setGroupName('');
      setGroupDescription('');
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const joinGroup = useMutation({
    mutationFn: async () => {
      // Find group by invite code using RPC (bypasses RLS)
      const { data: groups, error: findError } = await supabase
        .rpc('get_group_by_invite_code', { code: joinCode });

      if (findError || !groups || groups.length === 0) {
        throw new Error('Invalid invite code');
      }

      const group = groups[0];

      // Check if already a member
      const { data: existing } = await supabase
        .from('group_members')
        .select('id')
        .eq('group_id', group.id)
        .eq('user_id', user?.id)
        .single();

      if (existing) {
        throw new Error('You are already a member of this group');
      }

      // Join group
      const { error: joinError } = await supabase
        .from('group_members')
        .insert({
          group_id: group.id,
          user_id: user?.id,
          role: 'member',
        });

      if (joinError) throw joinError;

      return group;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setShowJoinModal(false);
      setJoinCode('');
      Alert.alert('Success', 'You have joined the group!');
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.primary} />
        }
      >
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setShowCreateModal(true)}
          >
            <Text style={styles.actionEmoji}>➕</Text>
            <Text style={styles.actionText}>Create Group</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.actionButtonSecondary]}
            onPress={() => setShowJoinModal(true)}
          >
            <Text style={styles.actionEmoji}>🔗</Text>
            <Text style={[styles.actionText, styles.actionTextSecondary]}>Join Group</Text>
          </TouchableOpacity>
        </View>

        {groups && groups.length > 0 ? (
          <View style={styles.groupList}>
            {groups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={styles.groupCard}
                onPress={() => router.push(`/(app)/group/${group.id}`)}
              >
                <View style={styles.groupInfo}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  {group.description && (
                    <Text style={styles.groupDescription} numberOfLines={1}>
                      {group.description}
                    </Text>
                  )}
                  <View style={styles.groupMeta}>
                    <Text style={styles.memberCount}>
                      👥 {group.member_count} members
                    </Text>
                    {group.role === 'admin' && (
                      <View style={styles.adminBadge}>
                        <Text style={styles.adminBadgeText}>Admin</Text>
                      </View>
                    )}
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : !isLoading ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>👥</Text>
            <Text style={styles.emptyText}>No groups yet</Text>
            <Text style={styles.emptySubtext}>
              Create a group or join one with an invite code
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Create Group Modal */}
      <Modal visible={showCreateModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Group</Text>

            <Text style={styles.label}>Group Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g., Weekend Warriors"
              placeholderTextColor={COLORS.gray[400]}
              value={groupName}
              onChangeText={setGroupName}
            />

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="What's this group about?"
              placeholderTextColor={COLORS.gray[400]}
              value={groupDescription}
              onChangeText={setGroupDescription}
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowCreateModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, !groupName.trim() && styles.submitButtonDisabled]}
                onPress={() => createGroup.mutate()}
                disabled={!groupName.trim() || createGroup.isPending}
              >
                <Text style={styles.submitButtonText}>
                  {createGroup.isPending ? 'Creating...' : 'Create'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Join Group Modal */}
      <Modal visible={showJoinModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Join Group</Text>

            <Text style={styles.label}>Invite Code</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 8-character code"
              placeholderTextColor={COLORS.gray[400]}
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              maxLength={8}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowJoinModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, joinCode.length !== 8 && styles.submitButtonDisabled]}
                onPress={() => joinGroup.mutate()}
                disabled={joinCode.length !== 8 || joinGroup.isPending}
              >
                <Text style={styles.submitButtonText}>
                  {joinGroup.isPending ? 'Joining...' : 'Join'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
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
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  actionButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  actionButtonSecondary: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.primary,
  },
  actionEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  actionTextSecondary: {
    color: COLORS.primary,
  },
  groupList: {
    gap: 12,
  },
  groupCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupInfo: {
    flex: 1,
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    marginBottom: 4,
  },
  groupDescription: {
    fontSize: 14,
    color: COLORS.gray[500],
    marginBottom: 8,
  },
  groupMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberCount: {
    fontSize: 12,
    color: COLORS.gray[500],
  },
  adminBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  adminBadgeText: {
    fontSize: 10,
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
    padding: 32,
    alignItems: 'center',
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.gray[500],
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.gray[900],
    marginBottom: 24,
    textAlign: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.gray[50],
    borderWidth: 1,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.gray[900],
    marginBottom: 16,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gray[300],
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[600],
  },
  submitButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
});
