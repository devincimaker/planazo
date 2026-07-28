import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Modal, Image, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { COLORS } from '../../../constants/colors';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, setProfile, logout } = useAuthStore();
  const queryClient = useQueryClient();
  const [showEditModal, setShowEditModal] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const updateProfile = useMutation({
    mutationFn: async () => {
      const updates: { display_name: string; avatar_url?: string | null } = {
        display_name: displayName.trim(),
      };
      if (avatarUrl !== profile?.avatar_url) {
        updates.avatar_url = avatarUrl || null;
      }

      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
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

  async function pickImage() {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert('Permission Required', 'Please allow access to your photo library to set a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled && result.assets[0]) {
      await uploadImage(result.assets[0].uri);
    }
  }

  async function uploadImage(uri: string) {
    if (!profile?.id) return;

    setIsUploadingAvatar(true);
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      const filePath = `${profile.id}/avatar.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, decode(base64), {
          upsert: true,
          contentType: 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const urlWithCacheBust = `${publicUrl}?t=${Date.now()}`;
      setAvatarUrl(urlWithCacheBust);
    } catch (error: any) {
      Alert.alert('Upload Error', error.message || 'Failed to upload image');
    } finally {
      setIsUploadingAvatar(false);
    }
  }

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

  const renderAvatar = (size: number, showEdit: boolean = false) => {
    const avatarSource = showEdit ? avatarUrl : profile?.avatar_url;

    if (avatarSource) {
      return (
        <Image
          source={{ uri: avatarSource }}
          style={[
            styles.avatarImage,
            { width: size, height: size, borderRadius: size / 2 },
          ]}
        />
      );
    }

    return (
      <View
        style={[
          styles.avatar,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>
          {profile?.display_name?.[0]?.toUpperCase() || '?'}
        </Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.profileCard}>
        {renderAvatar(80)}
        <Text style={styles.name}>{profile?.display_name}</Text>
        <Text style={styles.email}>{profile?.email}</Text>
        <TouchableOpacity
          style={styles.editButton}
          onPress={() => {
            setDisplayName(profile?.display_name || '');
            setAvatarUrl(profile?.avatar_url || '');
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

            {/* Avatar Picker */}
            <View style={styles.avatarPickerContainer}>
              <TouchableOpacity
                style={styles.avatarPicker}
                onPress={pickImage}
                disabled={isUploadingAvatar}
              >
                {isUploadingAvatar ? (
                  <View style={[styles.avatar, { width: 100, height: 100, borderRadius: 50 }]}>
                    <ActivityIndicator color={COLORS.white} />
                  </View>
                ) : (
                  renderAvatar(100, true)
                )}
                <View style={styles.avatarEditBadge}>
                  <Text style={styles.avatarEditBadgeText}>📷</Text>
                </View>
              </TouchableOpacity>
              <Text style={styles.avatarHint}>Tap to change photo</Text>
            </View>

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
                style={[styles.submitButton, (!displayName.trim() || isUploadingAvatar) && styles.submitButtonDisabled]}
                onPress={() => updateProfile.mutate()}
                disabled={!displayName.trim() || updateProfile.isPending || isUploadingAvatar}
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
  avatarImage: {
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
  avatarPickerContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  avatarPicker: {
    position: 'relative',
  },
  avatarEditBadge: {
    position: 'absolute',
    bottom: 16,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.gray[200],
  },
  avatarEditBadgeText: {
    fontSize: 16,
  },
  avatarHint: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginTop: 8,
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
