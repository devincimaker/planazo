import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Modal } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { COLORS } from '../../../constants/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, setProfile, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');

  const updateProfile = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .update({ display_name: displayName.trim() })
        .eq('id', profile?.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setProfile(data);
      setShowEditModal(false);
      Alert.alert('Success', 'Profile updated');
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  async function handleLogout() {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            queryClient.clear();
            logout();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.display_name?.[0]?.toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={styles.name}>{profile?.display_name}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => {
            setDisplayName(profile?.display_name || '');
            setShowEditModal(true);
          }}
        >
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
          <Text style={styles.menuEmoji}>🚪</Text>
          <Text style={[styles.menuText, styles.menuTextDanger]}>Logout</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Planazo v1.0.0</Text>
        <Text style={styles.footerSubtext}>Plan awesome adventures with friends</Text>
      </View>

      {/* Edit Profile Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Profile</Text>

            <Text style={styles.label}>Display Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Your name"
              value={displayName}
              onChangeText={setDisplayName}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setShowEditModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.submitButton, !displayName.trim() && styles.submitButtonDisabled]}
                onPress={() => updateProfile.mutate()}
                disabled={!displayName.trim() || updateProfile.isPending}
              >
                <Text style={styles.submitButtonText}>
                  {updateProfile.isPending ? 'Saving...' : 'Save'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
    padding: 16,
  },
  profileCard: {
    backgroundColor: COLORS.white,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.gray[900],
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: COLORS.gray[500],
    marginBottom: 16,
  },
  editButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  editButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  section: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    marginBottom: 24,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: 16,
    paddingBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.gray[100],
  },
  menuEmoji: {
    fontSize: 20,
    marginRight: 12,
  },
  menuText: {
    fontSize: 16,
    color: COLORS.gray[900],
  },
  menuTextDanger: {
    color: COLORS.error,
  },
  footer: {
    alignItems: 'center',
    marginTop: 'auto',
    paddingVertical: 24,
  },
  footerText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[400],
    marginBottom: 4,
  },
  footerSubtext: {
    fontSize: 12,
    color: COLORS.gray[400],
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
