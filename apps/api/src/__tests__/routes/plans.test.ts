import request from 'supertest';
import { app } from '../../index';
import { mockSupabaseAdmin, mockSupabase } from '../../__mocks__/supabase';

// Mock user IDs
const TEST_USER_ID = 'test-user-123';
const FRIEND_ID = 'friend-456';
const OTHER_USER_ID = 'other-user-789';
const PLAN_ID = 'plan-abc';

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

describe('Plans API', () => {
  describe('POST /api/plans/groupless', () => {
    it('should create a groupless plan with invites', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Beach Day',
        plan_type: 'fixed',
        created_by: TEST_USER_ID,
        group_id: null,
      };

      // Mock friendships check - user has FRIEND_ID as friend
      const friendshipBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({
          data: [{ requester_id: TEST_USER_ID, addressee_id: FRIEND_ID }],
          error: null,
        })),
      };

      // Mock plan insert
      const planBuilder = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      // Mock RSVP insert (for fixed plan auto-RSVP)
      const rsvpBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      // Mock plan_invites insert
      const inviteBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      // Mock profile lookup
      const profileBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { display_name: 'Test User' }, error: null }),
      };

      // Mock notifications insert
      const notifBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'friendships') return friendshipBuilder as any;
        if (table === 'plans') return planBuilder as any;
        if (table === 'rsvps') return rsvpBuilder as any;
        if (table === 'plan_invites') return inviteBuilder as any;
        if (table === 'profiles') return profileBuilder as any;
        if (table === 'notifications') return notifBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', '/api/plans/groupless')
        .send({
          title: 'Beach Day',
          plan_type: 'fixed',
          event_date: '2024-06-01',
          min_people: 2,
          invite_friend_ids: [FRIEND_ID],
        });

      expect(response.status).toBe(201);
      expect(response.body.id).toBe(PLAN_ID);
      expect(response.body.title).toBe('Beach Day');
    });

    it('should create a flexible plan with date options', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Flexible Hangout',
        plan_type: 'flexible',
        created_by: TEST_USER_ID,
        group_id: null,
      };

      const friendshipBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({
          data: [{ requester_id: TEST_USER_ID, addressee_id: FRIEND_ID }],
          error: null,
        })),
      };

      const planBuilder = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ data: [{ id: 'date-opt-1' }], error: null })),
      };

      const dateOptionsBuilder = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ data: [{ id: 'date-opt-1' }], error: null })),
      };

      const availabilityBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      const inviteBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      const profileBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { display_name: 'Test User' }, error: null }),
      };

      const notifBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      let planDateOptionsCallCount = 0;
      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'friendships') return friendshipBuilder as any;
        if (table === 'plans') return planBuilder as any;
        if (table === 'plan_date_options') {
          planDateOptionsCallCount++;
          if (planDateOptionsCallCount === 1) return dateOptionsBuilder as any;
          return dateOptionsBuilder as any;
        }
        if (table === 'date_availability') return availabilityBuilder as any;
        if (table === 'plan_invites') return inviteBuilder as any;
        if (table === 'profiles') return profileBuilder as any;
        if (table === 'notifications') return notifBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', '/api/plans/groupless')
        .send({
          title: 'Flexible Hangout',
          plan_type: 'flexible',
          date_options: ['2024-06-01', '2024-06-02'],
          min_people: 2,
          invite_friend_ids: [FRIEND_ID],
        });

      expect(response.status).toBe(201);
      expect(response.body.plan_type).toBe('flexible');
    });

    it('should return 400 when title is missing', async () => {
      const response = await authenticatedRequest('post', '/api/plans/groupless')
        .send({
          plan_type: 'fixed',
          invite_friend_ids: [FRIEND_ID],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Title and plan_type are required');
    });

    it('should return 400 when no invitees provided', async () => {
      const response = await authenticatedRequest('post', '/api/plans/groupless')
        .send({
          title: 'Beach Day',
          plan_type: 'fixed',
          invite_friend_ids: [],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Must invite at least one friend');
    });

    it('should return 400 when inviting non-friends', async () => {
      // Mock empty friendships (no friends)
      const friendshipBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ data: [], error: null })),
      };

      mockSupabaseAdmin.from.mockReturnValue(friendshipBuilder as any);

      const response = await authenticatedRequest('post', '/api/plans/groupless')
        .send({
          title: 'Beach Day',
          plan_type: 'fixed',
          invite_friend_ids: [OTHER_USER_ID],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Can only invite friends');
    });
  });

  describe('POST /api/plans/:planId/invite', () => {
    it('should add a friend to an existing groupless plan', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Beach Day',
        created_by: TEST_USER_ID,
        group_id: null,
      };

      // Mock plan fetch
      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      // Mock friendship check
      const friendshipBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'friendship-1' }, error: null }),
      };

      // Mock invite insert
      const inviteBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      // Mock profile
      const profileBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { display_name: 'Test' }, error: null }),
      };

      // Mock notification
      const notifBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'plans') return planBuilder as any;
        if (table === 'friendships') return friendshipBuilder as any;
        if (table === 'plan_invites') return inviteBuilder as any;
        if (table === 'profiles') return profileBuilder as any;
        if (table === 'notifications') return notifBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/invite`)
        .send({ friend_id: FRIEND_ID });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Friend invited');
    });

    it('should return 400 when friend_id is missing', async () => {
      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/invite`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('friend_id is required');
    });

    it('should return 404 when plan not found or not creator', async () => {
      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabaseAdmin.from.mockReturnValue(planBuilder as any);

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/invite`)
        .send({ friend_id: FRIEND_ID });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Plan not found or not authorized');
    });

    it('should return 400 when inviting non-friend', async () => {
      const mockPlan = {
        id: PLAN_ID,
        created_by: TEST_USER_ID,
        group_id: null,
      };

      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      const friendshipBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'plans') return planBuilder as any;
        if (table === 'friendships') return friendshipBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/invite`)
        .send({ friend_id: OTHER_USER_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Can only invite friends');
    });

    it('should return 400 when user already invited', async () => {
      const mockPlan = {
        id: PLAN_ID,
        created_by: TEST_USER_ID,
        group_id: null,
      };

      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        is: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      const friendshipBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        or: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'friendship-1' }, error: null }),
      };

      const inviteBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: { code: '23505', message: 'unique violation' } })),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'plans') return planBuilder as any;
        if (table === 'friendships') return friendshipBuilder as any;
        if (table === 'plan_invites') return inviteBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/invite`)
        .send({ friend_id: FRIEND_ID });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('User already invited');
    });
  });

  describe('POST /api/plans/:planId/check-lock', () => {
    it('should lock a fixed plan when min_people reached', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Beach Day',
        plan_type: 'fixed',
        status: 'open',
        min_people: 2,
      };

      // Mock plan fetch
      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      // Mock RSVP count
      const rsvpBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ count: 3, error: null })),
      };

      // Mock plan update
      const updateBuilder = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      // Mock RSVP select for notifications
      const rsvpSelectBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({
          data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
          error: null,
        })),
      };

      // Mock notifications
      const notifBuilder = {
        insert: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      let planCallCount = 0;
      let rsvpCallCount = 0;
      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          planCallCount++;
          if (planCallCount === 1) return planBuilder as any;
          return updateBuilder as any;
        }
        if (table === 'rsvps') {
          rsvpCallCount++;
          if (rsvpCallCount === 1) return rsvpBuilder as any;
          return rsvpSelectBuilder as any;
        }
        if (table === 'notifications') return notifBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/check-lock`);

      expect(response.status).toBe(200);
      expect(response.body.locked).toBe(true);
      expect(response.body.message).toBe('Plan locked');
    });

    it('should return locked: false when conditions not met', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Beach Day',
        plan_type: 'fixed',
        status: 'open',
        min_people: 5,
      };

      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      const rsvpBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ count: 2, error: null })),
      };

      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'plans') return planBuilder as any;
        if (table === 'rsvps') return rsvpBuilder as any;
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/check-lock`);

      expect(response.status).toBe(200);
      expect(response.body.locked).toBe(false);
    });

    it('should return 404 when plan not found', async () => {
      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
      };

      mockSupabaseAdmin.from.mockReturnValue(planBuilder as any);

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/check-lock`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Plan not found');
    });
  });

  describe('POST /api/plans/:planId/cancel', () => {
    it('should cancel a groupless plan when user is creator', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Beach Day',
        created_by: TEST_USER_ID,
        group_id: null,
      };

      // Mock plan fetch
      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      // Mock plan update
      const updateBuilder = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: jest.fn((resolve: any) => resolve({ error: null })),
      };

      let callCount = 0;
      mockSupabaseAdmin.from.mockImplementation((table: string) => {
        if (table === 'plans') {
          callCount++;
          if (callCount === 1) return planBuilder as any;
          return updateBuilder as any;
        }
        return {} as any;
      });

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Plan cancelled');
    });

    it('should return 403 when non-creator tries to cancel groupless plan', async () => {
      const mockPlan = {
        id: PLAN_ID,
        title: 'Beach Day',
        created_by: OTHER_USER_ID, // Different user
        group_id: null,
      };

      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: mockPlan, error: null }),
      };

      mockSupabaseAdmin.from.mockReturnValue(planBuilder as any);

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/cancel`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Not authorized to cancel this plan');
    });

    it('should return 404 when plan not found', async () => {
      const planBuilder = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };

      mockSupabaseAdmin.from.mockReturnValue(planBuilder as any);

      const response = await authenticatedRequest('post', `/api/plans/${PLAN_ID}/cancel`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Plan not found');
    });
  });
});
