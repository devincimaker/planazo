import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Share,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { COLORS } from '../../../../constants/colors';
import type { Group } from '@planazo/shared';

export default function GroupSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Group;
    },
    enabled: !!id,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  const updateGroup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('groups')
        .update({
          name: name.trim(),
          description: description.trim() || null,
        })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setIsEditing(false);
      Alert.alert('Success', 'Group updated');
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const leaveGroup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('group_members')
        .delete()
        .eq('group_id', id)
        .eq('user_id', user?.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace('/(app)/(tabs)/groups');
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const deleteGroup = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('groups').delete().eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      router.replace('/(app)/(tabs)/groups');
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  function startEditing() {
    setName(group?.name || '');
    setDescription(group?.description || '');
    setIsEditing(true);
  }

  function confirmLeave() {
    Alert.alert(
      'Leave Group',
      'Are you sure you want to leave this group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: () => leaveGroup.mutate(),
        },
      ]
    );
  }

  function confirmDelete() {
    Alert.alert(
      'Delete Group',
      'This will permanently delete the group and all its plans. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteGroup.mutate(),
        },
      ]
    );
  }

  async function shareInviteCode() {
    if (!group) return;
    try {
      await Share.share({
        message: `Join my group "${group.name}" on Planazo! Use code: ${group.invite_code}`,
      });
    } catch (error) {
      console.error(error);
    }
  }

  if (isLoading || !group) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Group Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Group Information</Text>
        <View style={styles.card}>
          {isEditing ? (
            <>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Group name"
              />
              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={description}
                onChangeText={setDescription}
                placeholder="Group description"
                multiline
                numberOfLines={3}
              />
              <View style={styles.editActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setIsEditing(false)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveButton, !name.trim() && styles.saveButtonDisabled]}
                  onPress={() => updateGroup.mutate()}
                  disabled={!name.trim() || updateGroup.isPending}
                >
                  <Text style={styles.saveButtonText}>
                    {updateGroup.isPending ? 'Saving...' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Name</Text>
                <Text style={styles.infoValue}>{group.name}</Text>
              </View>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Description</Text>
                <Text style={styles.infoValue}>
                  {group.description || 'No description'}
                </Text>
              </View>
              <TouchableOpacity style={styles.editButton} onPress={startEditing}>
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Invite Code */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Invite Code</Text>
        <View style={styles.card}>
          <View style={styles.codeContainer}>
            <Text style={styles.code}>{group.invite_code}</Text>
          </View>
          <TouchableOpacity style={styles.shareButton} onPress={shareInviteCode}>
            <Text style={styles.shareButtonText}>Share Invite</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Danger Zone */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Danger Zone</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.dangerButton} onPress={confirmLeave}>
            <Text style={styles.dangerButtonText}>Leave Group</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dangerButton, styles.deleteButton]}
            onPress={confirmDelete}
          >
            <Text style={styles.deleteButtonText}>Delete Group</Text>
          </TouchableOpacity>
        </View>
      </View>
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
  loadingText: {
    textAlign: 'center',
    marginTop: 32,
    color: COLORS.gray[500],
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
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray[500],
    marginBottom: 4,
  },
  infoValue: {
    fontSize: 16,
    color: COLORS.gray[900],
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
  editActions: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.gray[300],
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[600],
  },
  saveButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  editButton: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  codeContainer: {
    backgroundColor: COLORS.gray[100],
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  code: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.gray[900],
    letterSpacing: 4,
  },
  shareButton: {
    backgroundColor: COLORS.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  shareButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  dangerButton: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.error,
    alignItems: 'center',
    marginBottom: 12,
  },
  deleteButton: {
    backgroundColor: COLORS.error,
    marginBottom: 0,
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.error,
  },
  deleteButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
});
