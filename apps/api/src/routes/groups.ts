import { Router, Response } from 'express';
import { nanoid } from 'nanoid';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

export const groupRoutes = Router();

// All routes require authentication
groupRoutes.use(authMiddleware);

// Create a new group
groupRoutes.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    const userId = req.userId!;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Generate unique invite code
    const inviteCode = nanoid(8).toUpperCase();

    // Create group
    const { data: group, error: groupError } = await supabaseAdmin
      .from('groups')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        invite_code: inviteCode,
        created_by: userId,
      })
      .select()
      .single();

    if (groupError) {
      return res.status(500).json({ error: groupError.message });
    }

    // Add creator as admin
    const { error: memberError } = await supabaseAdmin
      .from('group_members')
      .insert({
        group_id: group.id,
        user_id: userId,
        role: 'admin',
      });

    if (memberError) {
      // Rollback group creation
      await supabaseAdmin.from('groups').delete().eq('id', group.id);
      return res.status(500).json({ error: memberError.message });
    }

    res.status(201).json(group);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Join a group via invite code
groupRoutes.post('/join', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { invite_code } = req.body;
    const userId = req.userId!;

    if (!invite_code) {
      return res.status(400).json({ error: 'Invite code is required' });
    }

    // Find group by invite code
    const { data: group, error: findError } = await supabaseAdmin
      .from('groups')
      .select('id, name')
      .eq('invite_code', invite_code.toUpperCase().trim())
      .single();

    if (findError || !group) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from('group_members')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', userId)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'You are already a member of this group' });
    }

    // Join group
    const { error: joinError } = await supabaseAdmin
      .from('group_members')
      .insert({
        group_id: group.id,
        user_id: userId,
        role: 'member',
      });

    if (joinError) {
      return res.status(500).json({ error: joinError.message });
    }

    res.json({ message: 'Successfully joined group', group });
  } catch (error) {
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// Kick a member from group (admin only)
groupRoutes.delete('/:groupId/members/:memberId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { groupId, memberId } = req.params;
    const userId = req.userId!;

    // Check if requester is admin
    const { data: adminCheck } = await supabaseAdmin
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .single();

    if (!adminCheck || adminCheck.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can kick members' });
    }

    // Delete member
    const { error } = await supabaseAdmin
      .from('group_members')
      .delete()
      .eq('id', memberId)
      .eq('group_id', groupId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ message: 'Member removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});
