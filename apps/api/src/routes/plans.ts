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

    // Check if user is creator or group admin
    const { data: membership } = await supabaseAdmin
      .from('group_members')
      .select('role')
      .eq('group_id', plan.group_id)
      .eq('user_id', userId)
      .single();

    if (plan.created_by !== userId && (!membership || membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Not authorized to cancel this plan' });
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
