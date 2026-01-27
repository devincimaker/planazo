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
  Image,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import { COLORS } from '../../../constants/colors';
import type { Profile, FriendsResponse, FriendshipWithProfiles } from '@planazo/shared';

export default function FriendsScreen() {
  const queryClient = useQueryClient();
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const {
    data: friendsData,
    isLoading,
    refetch,
  } = useQuery<FriendsResponse>({
    queryKey: ['friends'],
    queryFn: () => api.friends.list(),
  });

  const sendRequest = useMutation({
    mutationFn: (addresseeId: string) => api.friends.sendRequest(addresseeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      setShowSearchModal(false);
      setSearchQuery('');
      setSearchResults([]);
      Alert.alert('Success', 'Friend request sent!');
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });

  const acceptRequest = useMutation({
    mutationFn: (friendshipId: string) => api.friends.acceptRequest(friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });

  const declineRequest = useMutation({
    mutationFn: (friendshipId: string) => api.friends.declineRequest(friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });

  const cancelRequest = useMutation({
    mutationFn: (friendshipId: string) => api.friends.cancelRequest(friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });

  const removeFriend = useMutation({
    mutationFn: (friendshipId: string) => api.friends.remove(friendshipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });

  const handleSearch = async () => {
    if (searchQuery.length < 2) return;

    setIsSearching(true);
    try {
      const results = await api.friends.search(searchQuery);
      setSearchResults(results);
    } catch (error) {
      Alert.alert('Error', 'Failed to search users');
    } finally {
      setIsSearching(false);
    }
  };

  const handleRemoveFriend = (friendshipId: string, friendName: string) => {
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${friendName} from your friends?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeFriend.mutate(friendshipId),
        },
      ]
    );
  };

  const friends = friendsData?.friends || [];
  const pendingReceived = friendsData?.pendingReceived || [];
  const pendingSent = friendsData?.pendingSent || [];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.primary} />
        }
      >
        {/* Add Friend Button */}
        <TouchableOpacity style={styles.addButton} onPress={() => setShowSearchModal(true)}>
          <Text style={styles.addButtonEmoji}>🔍</Text>
          <Text style={styles.addButtonText}>Find Friends</Text>
        </TouchableOpacity>

        {/* Pending Requests Received */}
        {pendingReceived.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Friend Requests</Text>
            {pendingReceived.map((request: FriendshipWithProfiles) => (
              <View key={request.id} style={styles.requestCard}>
                <View style={styles.userInfo}>
                  {request.requester.avatar_url ? (
                    <Image source={{ uri: request.requester.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {request.requester.display_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.userName}>{request.requester.display_name}</Text>
                </View>
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => acceptRequest.mutate(request.id)}
                    disabled={acceptRequest.isPending}
                  >
                    <Text style={styles.acceptButtonText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.declineButton}
                    onPress={() => declineRequest.mutate(request.id)}
                    disabled={declineRequest.isPending}
                  >
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Pending Requests Sent */}
        {pendingSent.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sent Requests</Text>
            {pendingSent.map((request: FriendshipWithProfiles) => (
              <View key={request.id} style={styles.friendCard}>
                <View style={styles.userInfo}>
                  {request.addressee.avatar_url ? (
                    <Image source={{ uri: request.addressee.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {request.addressee.display_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View>
                    <Text style={styles.userName}>{request.addressee.display_name}</Text>
                    <Text style={styles.pendingText}>Pending</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => cancelRequest.mutate(request.id)}
                  disabled={cancelRequest.isPending}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {/* Friends List */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            Friends {friends.length > 0 && `(${friends.length})`}
          </Text>
          {friends.length > 0 ? (
            friends.map((item) => (
              <TouchableOpacity
                key={item.friendship.id}
                style={styles.friendCard}
                onLongPress={() => handleRemoveFriend(item.friendship.id, item.friend.display_name)}
              >
                <View style={styles.userInfo}>
                  {item.friend.avatar_url ? (
                    <Image source={{ uri: item.friend.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {item.friend.display_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.userName}>{item.friend.display_name}</Text>
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>👋</Text>
              <Text style={styles.emptyText}>No friends yet</Text>
              <Text style={styles.emptySubtext}>Tap "Find Friends" to add some!</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Search Modal */}
      <Modal visible={showSearchModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Find Friends</Text>

            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search by username..."
                placeholderTextColor={COLORS.gray[400]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                onSubmitEditing={handleSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.searchButton, searchQuery.length < 2 && styles.searchButtonDisabled]}
                onPress={handleSearch}
                disabled={searchQuery.length < 2 || isSearching}
              >
                <Text style={styles.searchButtonText}>{isSearching ? '...' : 'Search'}</Text>
              </TouchableOpacity>
            </View>

            {searchResults.length > 0 && (
              <ScrollView style={styles.searchResults}>
                {searchResults.map((user) => (
                  <View key={user.id} style={styles.searchResultItem}>
                    <View style={styles.userInfo}>
                      {user.avatar_url ? (
                        <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarPlaceholder}>
                          <Text style={styles.avatarText}>
                            {user.display_name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.userName}>{user.display_name}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.addFriendButton}
                      onPress={() => sendRequest.mutate(user.id)}
                      disabled={sendRequest.isPending}
                    >
                      <Text style={styles.addFriendButtonText}>
                        {sendRequest.isPending ? '...' : 'Add'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}

            {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
              <Text style={styles.noResults}>No users found</Text>
            )}

            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => {
                setShowSearchModal(false);
                setSearchQuery('');
                setSearchResults([]);
              }}
            >
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
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
  addButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  addButtonEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.gray[900],
    marginBottom: 12,
  },
  friendCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  requestCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  avatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.white,
  },
  userName: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.gray[900],
  },
  pendingText: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginTop: 2,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  acceptButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  acceptButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  declineButton: {
    flex: 1,
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  declineButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[600],
  },
  cancelButton: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray[600],
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
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.gray[900],
    marginBottom: 24,
    textAlign: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
    borderWidth: 1,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.gray[900],
  },
  searchButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  searchButtonDisabled: {
    opacity: 0.5,
  },
  searchButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  searchResults: {
    maxHeight: 300,
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  addFriendButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  addFriendButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  noResults: {
    textAlign: 'center',
    color: COLORS.gray[500],
    marginTop: 16,
  },
  closeButton: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.gray[300],
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[600],
  },
});
