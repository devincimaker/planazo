import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

export const friendRoutes = Router();

// All routes require authentication
friendRoutes.use(authMiddleware);

// Search users by display_name (for adding friends)
friendRoutes.get('/search', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { q } = req.query;
    const userId = req.userId!;

    if (!q || String(q).length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    // Search profiles by display_name, exclude self
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, display_name, avatar_url')
      .ilike('display_name', `%${q}%`)
      .neq('id', userId)
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// Get all friendships (friends + pending requests)
friendRoutes.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const { data, error } = await supabaseAdmin
      .from('friendships')
      .select(`
        *,
        requester:profiles!friendships_requester_id_fkey(id, display_name, avatar_url),
        addressee:profiles!friendships_addressee_id_fkey(id, display_name, avatar_url)
      `)
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Transform to make it easier for client
    const friends = data
      ?.filter((f) => f.status === 'accepted')
      .map((f) => ({
        friendship: {
          id: f.id,
          requester_id: f.requester_id,
          addressee_id: f.addressee_id,
          status: f.status,
          created_at: f.created_at,
          accepted_at: f.accepted_at,
        },
        friend: f.requester_id === userId ? f.addressee : f.requester,
      }));

    const pendingReceived = data?.filter(
      (f) => f.status === 'pending' && f.addressee_id === userId
    );

    const pendingSent = data?.filter(
      (f) => f.status === 'pending' && f.requester_id === userId
    );

    res.json({ friends, pendingReceived, pendingSent });
  } catch (error) {
    console.error('Get friendships error:', error);
    res.status(500).json({ error: 'Failed to get friendships' });
  }
});

// Send friend request
friendRoutes.post('/request', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { addressee_id } = req.body;
    const userId = req.userId!;

    if (!addressee_id) {
      return res.status(400).json({ error: 'addressee_id is required' });
    }

    if (addressee_id === userId) {
      return res.status(400).json({ error: 'Cannot send friend request to yourself' });
    }

    // Check if friendship already exists (in either direction)
    const { data: existing } = await supabaseAdmin
      .from('friendships')
      .select('id, status')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${addressee_id}),and(requester_id.eq.${addressee_id},addressee_id.eq.${userId})`
      )
      .maybeSingle();

    if (existing) {
      if (existing.status === 'accepted') {
        return res.status(400).json({ error: 'Already friends' });
      }
      return res.status(400).json({ error: 'Friend request already pending' });
    }

    // Create friend request
    const { data: friendship, error } = await supabaseAdmin
      .from('friendships')
      .insert({
        requester_id: userId,
        addressee_id: addressee_id,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get requester profile for notification
    const { data: requester } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    // Create notification for addressee
    await supabaseAdmin.from('notifications').insert({
      user_id: addressee_id,
      type: 'friend_request',
      title: 'New Friend Request',
      body: `${requester?.display_name || 'Someone'} wants to be your friend!`,
      data: { friendship_id: friendship.id, requester_id: userId },
    });

    res.status(201).json(friendship);
  } catch (error) {
    console.error('Send friend request error:', error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// Accept friend request
friendRoutes.post('/:friendshipId/accept', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { friendshipId } = req.params;
    const userId = req.userId!;

    // Verify user is the addressee and request is pending
    const { data: friendship, error: fetchError } = await supabaseAdmin
      .from('friendships')
      .select('*')
      .eq('id', friendshipId)
      .eq('addressee_id', userId)
      .eq('status', 'pending')
      .single();

    if (fetchError || !friendship) {
      return res.status(404).json({ error: 'Friend request not found' });
    }

    // Accept the request
    const { error } = await supabaseAdmin
      .from('friendships')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', friendshipId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Get accepter profile for notification
    const { data: accepter } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    // Notify the requester
    await supabaseAdmin.from('notifications').insert({
      user_id: friendship.requester_id,
      type: 'friend_accepted',
      title: 'Friend Request Accepted',
      body: `${accepter?.display_name || 'Someone'} accepted your friend request!`,
      data: { friendship_id: friendshipId, friend_id: userId },
    });

    res.json({ message: 'Friend request accepted' });
  } catch (error) {
    console.error('Accept friend request error:', error);
    res.status(500).json({ error: 'Failed to accept friend request' });
  }
});

// Decline friend request (delete the record)
friendRoutes.delete('/:friendshipId/decline', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { friendshipId } = req.params;
    const userId = req.userId!;

    // Verify user is the addressee and request is pending
    const { error } = await supabaseAdmin
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('addressee_id', userId)
      .eq('status', 'pending');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Friend request declined' });
  } catch (error) {
    console.error('Decline friend request error:', error);
    res.status(500).json({ error: 'Failed to decline friend request' });
  }
});

// Cancel sent friend request
friendRoutes.delete('/:friendshipId/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { friendshipId } = req.params;
    const userId = req.userId!;

    // Verify user is the requester and request is pending
    const { error } = await supabaseAdmin
      .from('friendships')
      .delete()
      .eq('id', friendshipId)
      .eq('requester_id', userId)
      .eq('status', 'pending');

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Friend request cancelled' });
  } catch (error) {
    console.error('Cancel friend request error:', error);
    res.status(500).json({ error: 'Failed to cancel friend request' });
  }
});

// Remove friend (unfriend)
friendRoutes.delete('/:friendshipId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { friendshipId } = req.params;
    const userId = req.userId!;

    // Verify user is part of this friendship and it's accepted
    const { data: friendship } = await supabaseAdmin
      .from('friendships')
      .select('*')
      .eq('id', friendshipId)
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
      .single();

    if (!friendship) {
      return res.status(404).json({ error: 'Friendship not found' });
    }

    const { error } = await supabaseAdmin
      .from('friendships')
      .delete()
      .eq('id', friendshipId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Friend removed' });
  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});
