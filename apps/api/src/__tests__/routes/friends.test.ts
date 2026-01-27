import request from 'supertest';
import { app } from '../../index';
import { mockSupabaseAdmin, mockSupabase } from '../../__mocks__/supabase';

// Mock user ID for authenticated requests
const TEST_USER_ID = 'test-user-123';
const OTHER_USER_ID = 'other-user-456';
const FRIENDSHIP_ID = 'friendship-789';

// Helper to create authenticated request
const authenticatedRequest = (method: 'get' | 'post' | 'delete', url: string) => {
  const req = request(app)[method](url);
  return req.set('Authorization', 'Bearer valid-token');
};

// Setup auth mock to return authenticated user
beforeEach(() => {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: TEST_USER_ID } },
    error: null,
  });
});

describe('Friends API', () => {
  describe('GET /api/friends/search', () => {
    it('should return matching users', async () => {
      const mockUsers = [
        { id: 'user-1', display_name: 'John Doe', avatar_url: null },
        { id: 'user-2', display_name: 'Johnny B', avatar_url: 'http://example.com/avatar.jpg' },
      ];

      const mockBuilder = {
        select: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ data: mockUsers, error: null })),
      };
      mockSupabaseAdmin.from.mockReturnValue(mockBuilder as any);

      const response = await authenticatedRequest('get', '/api/friends/search?q=john');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockUsers);
      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('profiles');
    });

    it('should return 400 when query is too short', async () => {
      const response = await authenticatedRequest('get', '/api/friends/search?q=j');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Query must be at least 2 characters');
    });

    it('should return 400 when query is missing', async () => {
      const response = await authenticatedRequest('get', '/api/friends/search');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Query must be at least 2 characters');
    });

    it('should return empty array when no matches found', async () => {
      const mockBuilder = {
        select: jest.fn().mockReturnThis(),
        ilike: jest.fn().mockReturnThis(),
        neq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ data: [], error: null })),
      };
      mockSupabaseAdmin.from.mockReturnValue(mockBuilder as any);

      const response = await authenticatedRequest('get', '/api/friends/search?q=xyz123');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should return 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token' },
      });

      const response = await request(app)
        .get('/api/friends/search?q=john')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/friends', () => {
    it('should return friends and pending requests', async () => {
      const mockFriendships = [
        {
          id: 'f1',
          requester_id: TEST_USER_ID,
          addressee_id: 'user-2',
          status: 'accepted',
          created_at: '2024-01-01',
          accepted_at: '2024-01-02',
          requester: { id: TEST_USER_ID, display_name: 'Me', avatar_url: null },
          addressee: { id: 'user-2', display_name: 'Friend 1', avatar_url: null },
        },
        {
          id: 'f2',
          requester_id: 'user-3',
          addressee_id: TEST_USER_ID,
          status: 'pending',
          created_at: '2024-01-03',
          accepted_at: null,
          requester: { id: 'user-3', display_name: 'Pending User', avatar_url: null },
          addressee: { id: TEST_USER_ID, display_name: 'Me', avatar_url: null },
        },
        {
          id: 'f3',
          requester_id: TEST_USER_ID,
          addressee_id: 'user-4',
          status: 'pending',
          created_at: '2024-01-04',
          accepted_at: null,
          requester: { id: TEST_USER_ID, display_name: 'Me', avatar_url: null },
          addressee: { id: 'user-4', display_name: 'Sent Request', avatar_url: null },
        },
      ];

      const mockBuilder = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ data: mockFriendships, error: null })),
      };
      mockSupabaseAdmin.from.mockReturnValue(mockBuilder as any);

      const response = await authenticatedRequest('get', '/api/friends');

      expect(response.status).toBe(200);
      expect(response.body.friends).toHaveLength(1);
      expect(response.body.pendingReceived).toHaveLength(1);
      expect(response.body.pendingSent).toHaveLength(1);
      expect(response.body.friends[0].friend.display_name).toBe('Friend 1');
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app).get('/api/friends');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/friends/request', () => {
    it('should create a pending friend request', async () => {
      const mockFriendship = {
        id: FRIENDSHIP_ID,
        requester_id: TEST_USER_ID,
        addressee_id: OTHER_USER_ID,
        status: 'pending',
      };

      // Mock no existing friendship
      const checkBuilder = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      // Mock insert friendship
      const insertBuilder = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockFriendship, error: null }),
      };

      // Mock profile lookup
      const profileBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { display_name: 'Test User' }, error: null }),
      };

      // Mock notification insert
      const notifBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      let callCount = 0;
      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'friendships') {
          callCount++;
          if (callCount === 1) return checkBuilder as any;
          return insertBuilder as any;
        }
        if (table === 'profiles') return profileBuilder as any;
        if (table === 'notifications') return notifBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', '/api/friends/request')
        .send({ addressee_id: OTHER_USER_ID });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(FRIENDSHIP_ID);
      expect(response.body.status).toBe('pending');
    });

    it('should return 400 when addressee_id is missing', async () => {
      const response = await authenticatedRequest('post', '/api/friends/request')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('addressee_id is required');
    });

    it('should return 400 when sending request to self', async () => {
      const response = await authenticatedRequest('post', '/api/friends/request')
        .send({ addressee_id: TEST_USER_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Cannot send friend request to yourself');
    });

    it('should return 400 when already friends', async () => {
      const checkBuilder = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'existing', status: 'accepted' },
          error: null,
        }),
      };
      mockSupabaseAdmin.from.mockReturnValue(checkBuilder as any);

      const response = await authenticatedRequest('post', '/api/friends/request')
        .send({ addressee_id: OTHER_USER_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Already friends');
    });

    it('should return 400 when request already pending', async () => {
      const checkBuilder = {
        select: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'existing', status: 'pending' },
          error: null,
        }),
      };
      mockSupabaseAdmin.from.mockReturnValue(checkBuilder as any);

      const response = await authenticatedRequest('post', '/api/friends/request')
        .send({ addressee_id: OTHER_USER_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Friend request already pending');
    });
  });

  describe('POST /api/friends/:friendshipId/accept', () => {
    it('should accept a pending friend request', async () => {
      const mockFriendship = {
        id: FRIENDSHIP_ID,
        requester_id: OTHER_USER_ID,
        addressee_id: TEST_USER_ID,
        status: 'pending',
      };

      // Mock fetch friendship
      const fetchBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockFriendship, error: null }),
      };

      // Mock update
      const updateBuilder = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      // Mock profile lookup
      const profileBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { display_name: 'Test User' }, error: null }),
      };

      // Mock notification
      const notifBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      let friendshipCallCount = 0;
      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'friendships') {
          friendshipCallCount++;
          if (friendshipCallCount === 1) return fetchBuilder as any;
          return updateBuilder as any;
        }
        if (table === 'profiles') return profileBuilder as any;
        if (table === 'notifications') return notifBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/friends/${FRIENDSHIP_ID}/accept`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Friend request accepted');
    });

    it('should return 404 when friendship not found', async () => {
      const fetchBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      };
      mockSupabaseAdmin.from.mockReturnValue(fetchBuilder as any);

      const response = await authenticatedRequest('post', `/api/friends/${FRIENDSHIP_ID}/accept`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Friend request not found');
    });

    it('should return 404 when user is not the addressee', async () => {
      // Friendship exists but user is not addressee (simulated by returning null)
      const fetchBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockSupabaseAdmin.from.mockReturnValue(fetchBuilder as any);

      const response = await authenticatedRequest('post', `/api/friends/${FRIENDSHIP_ID}/accept`);

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/friends/:friendshipId/decline', () => {
    it('should decline a pending friend request', async () => {
      const deleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };
      mockSupabaseAdmin.from.mockReturnValue(deleteBuilder as any);

      const response = await authenticatedRequest('delete', `/api/friends/${FRIENDSHIP_ID}/decline`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Friend request declined');
    });
  });

  describe('DELETE /api/friends/:friendshipId/cancel', () => {
    it('should cancel a sent friend request', async () => {
      const deleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };
      mockSupabaseAdmin.from.mockReturnValue(deleteBuilder as any);

      const response = await authenticatedRequest('delete', `/api/friends/${FRIENDSHIP_ID}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Friend request cancelled');
    });
  });

  describe('DELETE /api/friends/:friendshipId', () => {
    it('should remove a friend', async () => {
      const mockFriendship = {
        id: FRIENDSHIP_ID,
        requester_id: TEST_USER_ID,
        addressee_id: OTHER_USER_ID,
        status: 'accepted',
      };

      // Mock fetch friendship
      const fetchBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockFriendship, error: null }),
      };

      // Mock delete
      const deleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      let callCount = 0;
      mockSupabaseAdmin.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return fetchBuilder as any;
        return deleteBuilder as any;
      });

      const response = await authenticatedRequest('delete', `/api/friends/${FRIENDSHIP_ID}`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Friend removed');
    });

    it('should return 404 when friendship not found', async () => {
      const fetchBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      mockSupabaseAdmin.from.mockReturnValue(fetchBuilder as any);

      const response = await authenticatedRequest('delete', `/api/friends/${FRIENDSHIP_ID}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Friendship not found');
    });
  });
});
