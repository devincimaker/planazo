// API Client Tests
// Tests that the API client constructs correct requests
// These tests mock fetch and supabase to test the API client in isolation

// Reference global types
declare const global: typeof globalThis;

// Mock supabase before importing the api module
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}));

// Import after mocking
import { api } from '../api';

describe('API Client', () => {
  // Save original fetch
  const originalFetch = globalThis.fetch;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    // Reset fetch mock before each test
    mockFetch = jest.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('api.friends', () => {
    it('search should call correct endpoint with query param', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ id: '1', display_name: 'John' }]),
      });

      await api.friends.search('john');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends/search?q=john'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('list should call correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ friends: [], pendingReceived: [], pendingSent: [] }),
      });

      await api.friends.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('sendRequest should POST to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'friendship-1' }),
      });

      await api.friends.sendRequest('user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends/request'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ addressee_id: 'user-123' }),
        })
      );
    });

    it('acceptRequest should POST to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'accepted' }),
      });

      await api.friends.acceptRequest('friendship-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends/friendship-123/accept'),
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('declineRequest should DELETE to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'declined' }),
      });

      await api.friends.declineRequest('friendship-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends/friendship-123/decline'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('cancelRequest should DELETE to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'cancelled' }),
      });

      await api.friends.cancelRequest('friendship-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends/friendship-123/cancel'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('remove should DELETE to correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ message: 'removed' }),
      });

      await api.friends.remove('friendship-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/friends/friendship-123'),
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should throw error on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed' }),
      });

      await expect(api.friends.list()).rejects.toThrow('Failed to get friends');
    });
  });

  describe('api.plans', () => {
    it('createGroupless should POST correct payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'plan-1', title: 'Beach Day' }),
      });

      const planData = {
        title: 'Beach Day',
        plan_type: 'fixed' as const,
        min_people: 2,
        invite_friend_ids: ['friend-1'],
      };
      await api.plans.createGroupless(planData);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/plans/groupless'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(planData),
        })
      );
    });
  });
});
