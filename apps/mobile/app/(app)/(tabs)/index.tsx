import { View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
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
      if (!memberships || memberships.length === 0) return [];

      const groupIds = memberships.map((m) => m.group_id);

      // Get all plans from user's groups with RSVPs and date availabilities
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
      return data || [];
    },
    enabled: !!user,
  });

  // Filter for "Upcoming Plans" - confirmed plans where user is participating
  const upcomingPlans = plans?.filter((plan: any) => {
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
  const needsResponsePlans = plans?.filter((plan: any) => {
    if (plan.status !== 'open') return false;

    if (plan.plan_type === 'fixed') {
      const userRsvp = plan.rsvps?.find((r: any) => r.user_id === user?.id);
      return !userRsvp || userRsvp.response === null;
    } else {
      // No availability marked by user
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
                  <Text style={styles.planGroup}>{plan.groups?.name}</Text>
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
                <Text style={styles.planGroup}>{plan.groups?.name}</Text>
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
    </ScrollView>
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
});
