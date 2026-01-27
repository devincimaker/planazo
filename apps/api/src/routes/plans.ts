import { Router, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

export const planRoutes = Router();

// All routes require authentication
planRoutes.use(authMiddleware);

// Check and lock a flexible plan if conditions are met
planRoutes.post('/:planId/check-lock', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { planId } = req.params;

    // Get plan details
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('id', planId)
      .single();

    if (planError || !plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (plan.status !== 'open') {
      return res.json({ message: 'Plan is not open', locked: false });
    }

    if (plan.plan_type === 'fixed') {
      // For fixed plans, check RSVP count
      const { count: rsvpCount } = await supabaseAdmin
        .from('rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('plan_id', planId)
        .eq('response', 'yes');

      if (rsvpCount && rsvpCount >= plan.min_people) {
        // Lock the plan
        await supabaseAdmin
          .from('plans')
          .update({
            status: 'locked',
            locked_at: new Date().toISOString(),
          })
          .eq('id', planId);

        // Create notifications for participants
        const { data: rsvps } = await supabaseAdmin
          .from('rsvps')
          .select('user_id')
          .eq('plan_id', planId)
          .eq('response', 'yes');

        if (rsvps) {
          const notifications = rsvps.map((rsvp) => ({
            user_id: rsvp.user_id,
            type: 'plan_locked',
            title: 'Plan Confirmed!',
            body: `"${plan.title}" is happening!`,
            data: { plan_id: planId, group_id: plan.group_id },
          }));

          await supabaseAdmin.from('notifications').insert(notifications);
        }

        return res.json({ message: 'Plan locked', locked: true });
      }
    } else {
      // For flexible plans, check availability overlap
      const { data: dateOptions } = await supabaseAdmin
        .from('plan_date_options')
        .select('id, date')
        .eq('plan_id', planId);

      if (!dateOptions || dateOptions.length === 0) {
        return res.json({ message: 'No date options', locked: false });
      }

      // Get availability counts for each date
      const { data: availabilities } = await supabaseAdmin
        .from('date_availability')
        .select('date_option_id, user_id')
        .eq('plan_id', planId)
        .eq('available', true);

      if (!availabilities) {
        return res.json({ message: 'No availabilities', locked: false });
      }

      // Count per date option
      const countByDate: Record<string, { count: number; date: string }> = {};
      dateOptions.forEach((opt) => {
        countByDate[opt.id] = { count: 0, date: opt.date };
      });

      availabilities.forEach((a) => {
        if (countByDate[a.date_option_id]) {
          countByDate[a.date_option_id].count++;
        }
      });

      // Find dates with enough people
      const viableDates = Object.entries(countByDate)
        .filter(([_, val]) => val.count >= plan.min_people)
        .sort((a, b) => b[1].count - a[1].count);

      if (viableDates.length > 0) {
        // Pick the date with most availability
        const [_, bestDate] = viableDates[0];

        // Lock the plan
        await supabaseAdmin
          .from('plans')
          .update({
            status: 'locked',
            locked_date: bestDate.date,
            locked_at: new Date().toISOString(),
          })
          .eq('id', planId);

        // Create notifications for available users on that date
        const dateOptionId = viableDates[0][0];
        const availableUsers = availabilities
          .filter((a) => a.date_option_id === dateOptionId)
          .map((a) => a.user_id);

        const notifications = availableUsers.map((userId) => ({
          user_id: userId,
          type: 'plan_locked',
          title: 'Plan Confirmed!',
          body: `"${plan.title}" is happening on ${new Date(bestDate.date).toLocaleDateString()}!`,
          data: { plan_id: planId, group_id: plan.group_id },
        }));

        await supabaseAdmin.from('notifications').insert(notifications);

        return res.json({
          message: 'Plan locked',
          locked: true,
          locked_date: bestDate.date,
        });
      }
    }

    res.json({ message: 'Conditions not met', locked: false });
  } catch (error) {
    console.error('Check lock error:', error);
    res.status(500).json({ error: 'Failed to check plan lock' });
  }
});

// Create groupless plan with friend invites
planRoutes.post('/groupless', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const {
      title,
      description,
      location,
      plan_type,
      event_date,
      date_options,
      min_people,
      max_people,
      deadline,
      invite_friend_ids,
    } = req.body;

    if (!title || !plan_type) {
      return res.status(400).json({ error: 'Title and plan_type are required' });
    }

    if (!invite_friend_ids || invite_friend_ids.length === 0) {
      return res.status(400).json({ error: 'Must invite at least one friend' });
    }

    // Verify all invitees are friends
    const { data: friendships } = await supabaseAdmin
      .from('friendships')
      .select('requester_id, addressee_id')
      .eq('status', 'accepted')
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

    const friendIds =
      friendships?.map((f) =>
        f.requester_id === userId ? f.addressee_id : f.requester_id
      ) || [];

    const invalidInvites = invite_friend_ids.filter(
      (id: string) => !friendIds.includes(id)
    );
    if (invalidInvites.length > 0) {
      return res.status(400).json({ error: 'Can only invite friends' });
    }

    // Create the plan (group_id = null for groupless)
    const { data: plan, error: planError } = await supabaseAdmin
      .from('plans')
      .insert({
        group_id: null, // Groupless!
        created_by: userId,
        title: title.trim(),
        description: description?.trim() || null,
        location: location?.trim() || null,
        plan_type,
        event_date: plan_type === 'fixed' ? event_date : null,
        min_people: min_people || 2,
        max_people: max_people || null,
        deadline: deadline || null,
        status: 'open',
      })
      .select()
      .single();

    if (planError) {
      return res.status(500).json({ error: planError.message });
    }

    // Add date options for flexible plans
    if (plan_type === 'flexible' && date_options?.length > 0) {
      const dateOptionRecords = date_options.map((date: string) => ({
        plan_id: plan.id,
        date: new Date(date).toISOString(),
      }));

      await supabaseAdmin.from('plan_date_options').insert(dateOptionRecords);

      // Auto-mark creator as available for all dates
      const { data: insertedDateOptions } = await supabaseAdmin
        .from('plan_date_options')
        .select('id')
        .eq('plan_id', plan.id);

      if (insertedDateOptions) {
        const availabilities = insertedDateOptions.map((opt) => ({
          plan_id: plan.id,
          date_option_id: opt.id,
          user_id: userId,
          available: true,
        }));

        await supabaseAdmin.from('date_availability').insert(availabilities);
      }
    } else {
      // For fixed plans, auto-RSVP creator as "yes"
      await supabaseAdmin.from('rsvps').insert({
        plan_id: plan.id,
        user_id: userId,
        response: 'yes',
      });
    }

    // Create invite records
    const inviteRecords = invite_friend_ids.map((friendId: string) => ({
      plan_id: plan.id,
      user_id: friendId,
      invited_by: userId,
    }));

    await supabaseAdmin.from('plan_invites').insert(inviteRecords);

    // Get creator profile for notifications
    const { data: creator } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    // Send notifications to all invitees
    const notifications = invite_friend_ids.map((friendId: string) => ({
      user_id: friendId,
      type: 'plan_invite',
      title: 'Plan Invitation',
      body: `${creator?.display_name || 'A friend'} invited you to "${title}"`,
      data: { plan_id: plan.id },
    }));

    await supabaseAdmin.from('notifications').insert(notifications);

    res.status(201).json(plan);
  } catch (error) {
    console.error('Create groupless plan error:', error);
    res.status(500).json({ error: 'Failed to create groupless plan' });
  }
});

// Add friend to existing groupless plan
planRoutes.post('/:planId/invite', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { planId } = req.params;
    const { friend_id } = req.body;
    const userId = req.userId!;

    if (!friend_id) {
      return res.status(400).json({ error: 'friend_id is required' });
    }

    // Verify plan is groupless and user is creator
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('*')
      .eq('id', planId)
      .eq('created_by', userId)
      .is('group_id', null)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found or not authorized' });
    }

    // Verify invitee is a friend
    const { data: friendship } = await supabaseAdmin
      .from('friendships')
      .select('id')
      .eq('status', 'accepted')
      .or(
        `and(requester_id.eq.${userId},addressee_id.eq.${friend_id}),and(requester_id.eq.${friend_id},addressee_id.eq.${userId})`
      )
      .maybeSingle();

    if (!friendship) {
      return res.status(400).json({ error: 'Can only invite friends' });
    }

    // Create invite
    const { error } = await supabaseAdmin.from('plan_invites').insert({
      plan_id: planId,
      user_id: friend_id,
      invited_by: userId,
    });

    if (error) {
      if (error.code === '23505') {
        // unique violation
        return res.status(400).json({ error: 'User already invited' });
      }
      return res.status(500).json({ error: error.message });
    }

    // Get creator profile for notification
    const { data: creator } = await supabaseAdmin
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .single();

    // Send notification
    await supabaseAdmin.from('notifications').insert({
      user_id: friend_id,
      type: 'plan_invite',
      title: 'Plan Invitation',
      body: `${creator?.display_name || 'A friend'} invited you to "${plan.title}"`,
      data: { plan_id: planId },
    });

    res.json({ message: 'Friend invited' });
  } catch (error) {
    console.error('Invite to plan error:', error);
    res.status(500).json({ error: 'Failed to invite friend to plan' });
  }
});

// Cancel a plan (admin or creator only)
planRoutes.post('/:planId/cancel', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { planId } = req.params;
    const userId = req.userId!;

    // Get plan with group info
    const { data: plan } = await supabaseAdmin
      .from('plans')
      .select('*, group:groups(*)')
      .eq('id', planId)
      .single();

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // For groupless plans, only creator can cancel
    if (plan.group_id === null) {
      if (plan.created_by !== userId) {
        return res.status(403).json({ error: 'Not authorized to cancel this plan' });
      }
    } else {
      // For group plans, check if user is creator or group admin
      const { data: membership } = await supabaseAdmin
        .from('group_members')
        .select('role')
        .eq('group_id', plan.group_id)
        .eq('user_id', userId)
        .single();

      if (plan.created_by !== userId && (!membership || membership.role !== 'admin')) {
        return res.status(403).json({ error: 'Not authorized to cancel this plan' });
      }
    }

    // Cancel the plan
    await supabaseAdmin
      .from('plans')
      .update({ status: 'cancelled' })
      .eq('id', planId);

    res.json({ message: 'Plan cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel plan' });
  }
});
