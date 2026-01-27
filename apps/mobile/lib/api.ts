import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('Not authenticated');
  }

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export const api = {
  // Friends endpoints
  friends: {
    search: async (query: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends/search?q=${encodeURIComponent(query)}`, {
        headers,
      });
      if (!response.ok) throw new Error('Failed to search users');
      return response.json();
    },

    list: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends`, { headers });
      if (!response.ok) throw new Error('Failed to get friends');
      return response.json();
    },

    sendRequest: async (addresseeId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends/request`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ addressee_id: addresseeId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to send friend request');
      }
      return response.json();
    },

    acceptRequest: async (friendshipId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends/${friendshipId}/accept`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to accept friend request');
      return response.json();
    },

    declineRequest: async (friendshipId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends/${friendshipId}/decline`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error('Failed to decline friend request');
      return response.json();
    },

    cancelRequest: async (friendshipId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends/${friendshipId}/cancel`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error('Failed to cancel friend request');
      return response.json();
    },

    remove: async (friendshipId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/friends/${friendshipId}`, {
        method: 'DELETE',
        headers,
      });
      if (!response.ok) throw new Error('Failed to remove friend');
      return response.json();
    },
  },

  // Groupless plans endpoints
  plans: {
    createGroupless: async (data: {
      title: string;
      description?: string;
      location?: string;
      plan_type: 'fixed' | 'flexible';
      event_date?: string;
      date_options?: string[];
      min_people: number;
      max_people?: number;
      deadline?: string;
      invite_friend_ids: string[];
    }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/plans/groupless`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create plan');
      }
      return response.json();
    },

    inviteFriend: async (planId: string, friendId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/plans/${planId}/invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ friend_id: friendId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to invite friend');
      }
      return response.json();
    },

    checkLock: async (planId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/plans/${planId}/check-lock`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to check plan lock');
      return response.json();
    },

    cancel: async (planId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_URL}/api/plans/${planId}/cancel`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error('Failed to cancel plan');
      return response.json();
    },
  },
};
