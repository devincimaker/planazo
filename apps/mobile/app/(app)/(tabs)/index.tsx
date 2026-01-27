import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { COLORS } from '../../../constants/colors';
import { useAuthStore } from '../../../stores/authStore';
import { supabase } from '../../../lib/supabase';

export default function HomeScreen() {
  const { profile, user } = useAuthStore();
  const router = useRouter();

  const { data: plans, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['home-plans', user?.id],
    queryFn: async () => {
      // First get user's group IDs
      const { data: memberships, error: memberError } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', user?.id);

      if (memberError) throw memberError;

      const groupIds = memberships?.map((m) => m.group_id) || [];

      // Get all plans from user's groups with RSVPs and date availabilities
      let groupPlans: any[] = [];
      if (groupIds.length > 0) {
        const { data, error } = await supabase
          .from('plans')
          .select(`
            *,
            groups(id, name),
            rsvps(user_id, response),
            plan_date_options(id, date, date_availability(user_id))
          `)
          .in('group_id', groupIds)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false });

        if (error) throw error;
        groupPlans = data || [];
      }

      // Get groupless plans where user is invited or is creator
      const { data: invitedPlanIds } = await supabase
        .from('plan_invites')
        .select('plan_id')
        .eq('user_id', user?.id);

      const invitedIds = invitedPlanIds?.map((i) => i.plan_id) || [];

      // Query for groupless plans (user created OR was invited)
      let grouplessPlans: any[] = [];
      const { data: createdPlans, error: createdError } = await supabase
        .from('plans')
        .select(`
          *,
          rsvps(user_id, response),
          plan_date_options(id, date, date_availability(user_id)),
          plan_invites(user_id, profiles:user_id(display_name))
        `)
        .is('group_id', null)
        .eq('created_by', user?.id)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (!createdError && createdPlans) {
        grouplessPlans = createdPlans.map((p) => ({ ...p, isGroupless: true }));
      }

      // Get invited groupless plans (not created by user)
      if (invitedIds.length > 0) {
        const { data: invitedPlans, error: invitedError } = await supabase
          .from('plans')
          .select(`
            *,
            rsvps(user_id, response),
            plan_date_options(id, date, date_availability(user_id)),
            plan_invites(user_id, profiles:user_id(display_name)),
            creator:created_by(display_name)
          `)
          .in('id', invitedIds)
          .is('group_id', null)
          .neq('created_by', user?.id)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false });

        if (!invitedError && invitedPlans) {
          grouplessPlans = [
            ...grouplessPlans,
            ...invitedPlans.map((p) => ({ ...p, isGroupless: true })),
          ];
        }
      }

      // Combine all plans and sort by creation date
      const allPlans = [...groupPlans, ...grouplessPlans].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return allPlans;
    },
    enabled: !!user,
  });

  // Helper to get event date from a plan
  const getEventDate = (plan: any): Date | null => {
    if (plan.locked_date) {
      return new Date(plan.locked_date);
    }
    if (plan.event_date) {
      return new Date(plan.event_date);
    }
    if (plan.plan_date_options?.length > 0) {
      // For flexible plans, use the earliest date that meets minimum
      const bestOption = plan.plan_date_options
        .map((opt: any) => ({
          date: opt.date,
          count: opt.date_availability?.length || 0,
        }))
        .filter((opt: any) => opt.count >= plan.min_people)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

      if (bestOption) {
        return new Date(bestOption.date);
      }
    }
    return null;
  };

  // Filter for "Past Plans" - groupless plans where the event date has passed
  const pastPlans = plans?.filter((plan: any) => {
    // Only show groupless plans in past section
    if (!plan.isGroupless) return false;

    const eventDate = getEventDate(plan);
    if (!eventDate) return false;

    // Check if the day after the event has passed
    const dayAfterEvent = new Date(eventDate);
    dayAfterEvent.setDate(dayAfterEvent.getDate() + 1);
    dayAfterEvent.setHours(0, 0, 0, 0);

    const now = new Date();
    return now >= dayAfterEvent;
  }) || [];

  // Get active plans (excluding past groupless plans)
  const activePlans = plans?.filter((plan: any) => {
    if (!plan.isGroupless) return true;
    return !pastPlans.some((p: any) => p.id === plan.id);
  }) || [];

  // Filter for "Upcoming Plans" - confirmed plans where user is participating
  const upcomingPlans = activePlans?.filter((plan: any) => {
    // Check if user is participating
    let userParticipating = false;
    if (plan.plan_type === 'fixed') {
      const userRsvp = plan.rsvps?.find((r: any) => r.user_id === user?.id);
      userParticipating = userRsvp?.response === 'yes';
    } else {
      userParticipating = plan.plan_date_options?.some((opt: any) =>
        opt.date_availability?.some((a: any) => a.user_id === user?.id)
      );
    }
    if (!userParticipating) return false;

    // Check if plan is confirmed (has enough people)
    if (plan.plan_type === 'fixed') {
      const yesCount = plan.rsvps?.filter((r: any) => r.response === 'yes').length || 0;
      return yesCount >= plan.min_people;
    } else {
      // For flexible: any date has enough people
      return plan.plan_date_options?.some((opt: any) => {
        const count = opt.date_availability?.length || 0;
        return count >= plan.min_people;
      });
    }
  }) || [];

  // Filter for "Needs Your Response" - open plans user hasn't responded to
  const needsResponsePlans = activePlans?.filter((plan: any) => {
    if (plan.status !== 'open') return false;

    if (plan.plan_type === 'fixed') {
      const userRsvp = plan.rsvps?.find((r: any) => r.user_id === user?.id);
      return !userRsvp || userRsvp.response === null;
    } else {
      // For flexible: check if user declined OR has availability
      const userRsvp = plan.rsvps?.find((r: any) => r.user_id === user?.id);
      if (userRsvp?.response === 'no') return false; // Declined

      const hasAvailability = plan.plan_date_options?.some((opt: any) =>
        opt.date_availability?.some((a: any) => a.user_id === user?.id)
      );
      return !hasAvailability;
    }
  }) || [];

  const formatDate = (plan: any) => {
    if (plan.locked_date) {
      return new Date(plan.locked_date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
    if (plan.event_date) {
      return new Date(plan.event_date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    }
    // For flexible plans, find the earliest date that meets minimum people
    if (plan.plan_date_options?.length > 0) {
      const bestOption = plan.plan_date_options
        .map((opt: any) => ({
          date: opt.date,
          count: opt.date_availability?.length || 0,
        }))
        .filter((opt: any) => opt.count >= plan.min_people)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

      if (bestOption) {
        return new Date(bestOption.date).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
      }
      return `${plan.plan_date_options.length} date options`;
    }
    return 'No date set';
  };

  const onRefresh = async () => {
    await refetch();
  };

  return (
    <View style={styles.wrapper}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={COLORS.primary} />
      }
    >
      <View style={styles.welcomeCard}>
        <Text style={styles.welcomeText}>
          Welcome back, {profile?.display_name || 'Friend'}!
        </Text>
        <Text style={styles.welcomeSubtext}>
          Ready for your next adventure?
        </Text>
      </View>

      {/* Needs Your Response Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Needs Your Response</Text>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : needsResponsePlans.length > 0 ? (
          <View style={styles.planList}>
            {needsResponsePlans.map((plan: any) => (
              <TouchableOpacity
                key={plan.id}
                style={styles.planCardUrgent}
                onPress={() => router.push(`/(app)/plan/${plan.id}`)}
              >
                <View style={styles.urgentIndicator} />
                <View style={styles.planCardContent}>
                  <View style={styles.planHeader}>
                    <Text style={styles.planType}>
                      {plan.plan_type === 'fixed' ? '📅' : '🗓️'}
                    </Text>
                    <Text style={styles.planTitle}>{plan.title}</Text>
                  </View>
                  <Text style={styles.planGroup}>
                    {plan.isGroupless ? 'With friends' : plan.groups?.name}
                  </Text>
                  <Text style={styles.planDate}>{formatDate(plan)}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>✅</Text>
            <Text style={styles.emptyText}>All caught up!</Text>
            <Text style={styles.emptySubtext}>
              No pending plans requiring your response
            </Text>
          </View>
        )}
      </View>

      {/* Upcoming Plans Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Upcoming Plans</Text>
        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
        ) : upcomingPlans.length > 0 ? (
          <View style={styles.planList}>
            {upcomingPlans.map((plan: any) => (
              <TouchableOpacity
                key={plan.id}
                style={styles.planCard}
                onPress={() => router.push(`/(app)/plan/${plan.id}`)}
              >
                <View style={styles.planHeader}>
                  <Text style={styles.planType}>
                    {plan.plan_type === 'fixed' ? '📅' : '🗓️'}
                  </Text>
                  <Text style={styles.planTitle}>{plan.title}</Text>
                </View>
                <Text style={styles.planGroup}>
                  {plan.isGroupless ? 'With friends' : plan.groups?.name}
                </Text>
                <Text style={styles.planDatePrimary}>{formatDate(plan)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={styles.emptyText}>No upcoming plans yet</Text>
            <Text style={styles.emptySubtext}>
              Join a group and RSVP to plans!
            </Text>
          </View>
        )}
      </View>

      {/* Past Plans Section - only for groupless plans */}
      {pastPlans.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Past Plans</Text>
          <View style={styles.planList}>
            {pastPlans.map((plan: any) => (
              <TouchableOpacity
                key={plan.id}
                style={styles.planCardPast}
                onPress={() => router.push(`/(app)/plan/${plan.id}`)}
              >
                <View style={styles.planHeader}>
                  <Text style={styles.planType}>
                    {plan.plan_type === 'fixed' ? '📅' : '🗓️'}
                  </Text>
                  <Text style={styles.planTitlePast}>{plan.title}</Text>
                </View>
                <Text style={styles.planGroup}>With friends</Text>
                <Text style={styles.planDatePast}>{formatDate(plan)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </ScrollView>

    {/* Floating Action Button for creating groupless plans */}
    <Pressable
      style={styles.fab}
      onPress={() => router.push('/(app)/plan/create')}
    >
      <Text style={styles.fabText}>+</Text>
    </Pressable>
  </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.gray[50],
  },
  content: {
    padding: 16,
  },
  welcomeCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.white,
    marginBottom: 4,
  },
  welcomeSubtext: {
    fontSize: 16,
    color: COLORS.white,
    opacity: 0.9,
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
  loadingState: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
  },
  planList: {
    gap: 12,
  },
  planCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  planCardPast: {
    backgroundColor: COLORS.gray[100],
    borderRadius: 12,
    padding: 16,
    opacity: 0.8,
  },
  planCardUrgent: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  urgentIndicator: {
    width: 4,
    backgroundColor: COLORS.primary,
  },
  planCardContent: {
    flex: 1,
    padding: 16,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  planType: {
    fontSize: 18,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    flex: 1,
  },
  planTitlePast: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[500],
    flex: 1,
  },
  planGroup: {
    fontSize: 14,
    color: COLORS.gray[500],
    marginBottom: 4,
  },
  planDate: {
    fontSize: 14,
    color: COLORS.gray[600],
  },
  planDatePrimary: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
  },
  planDatePast: {
    fontSize: 14,
    color: COLORS.gray[400],
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fabText: {
    fontSize: 32,
    color: COLORS.white,
    fontWeight: '300',
    marginTop: -2,
  },
});
