import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Share } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { COLORS } from '../../../../constants/colors';
import type { Group, Plan, GroupMember } from '@planazo/shared';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();

  const { data: group, isLoading: groupLoading, refetch } = useQuery({
    queryKey: ['group', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Group;
    },
    enabled: !!id,
  });

  const { data: membership } = useQuery({
    queryKey: ['group-membership', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('*')
        .eq('group_id', id)
        .eq('user_id', user?.id)
        .single();

      if (error) throw error;
      return data as GroupMember;
    },
    enabled: !!id && !!user,
  });

  const { data: plans, isLoading: plansLoading } = useQuery({
    queryKey: ['group-plans', id],
    queryFn: async () => {
      // Fetch plans with RSVP counts and date availabilities
      const { data, error } = await supabase
        .from('plans')
        .select(`
          *,
          rsvps(response),
          plan_date_options(id, date, date_availability(id, user_id))
        `)
        .eq('group_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Calculate confirmed status for each plan
      return (data || []).map((plan: any) => {
        const yesCount = plan.rsvps?.filter((r: any) => r.response === 'yes').length || 0;

        // For flexible plans, check if any date has enough people
        let flexibleConfirmed = false;
        let bestDateCount = 0;
        if (plan.plan_type === 'flexible' && plan.plan_date_options) {
          plan.plan_date_options.forEach((opt: any) => {
            const count = opt.date_availability?.length || 0;
            if (count > bestDateCount) bestDateCount = count;
            if (count >= plan.min_people) flexibleConfirmed = true;
          });
        }

        return {
          ...plan,
          yes_count: plan.plan_type === 'fixed' ? yesCount : bestDateCount,
          is_confirmed: plan.plan_type === 'fixed'
            ? yesCount >= plan.min_people
            : flexibleConfirmed,
        };
      }) as (Plan & { yes_count: number; is_confirmed: boolean })[];
    },
    enabled: !!id,
  });

  const { data: memberCount } = useQuery({
    queryKey: ['group-member-count', id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('group_members')
        .select('*', { count: 'exact', head: true })
        .eq('group_id', id);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!id,
  });

  const isAdmin = membership?.role === 'admin';

  const getBestDate = (plan: any) => {
    if (plan.locked_date) return plan.locked_date;
    if (plan.event_date) return plan.event_date;

    // For flexible plans, find earliest date meeting minimum
    if (plan.plan_date_options?.length > 0) {
      const bestOption = plan.plan_date_options
        .map((opt: any) => ({
          date: opt.date,
          count: opt.date_availability?.length || 0,
        }))
        .filter((opt: any) => opt.count >= plan.min_people)
        .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

      if (bestOption) return bestOption.date;
    }
    return null;
  };

  async function shareInviteCode() {
    if (!group) return;
    try {
      await Share.share({
        message: `Join my group "${group.name}" on Planazo! Use code: ${group.invite_code}`,
      });
    } catch (error) {
      console.error(error);
    }
  }

  // Split plans: confirmed (min reached but still open), open (not yet confirmed), cancelled
  const confirmedPlans = plans?.filter((p) => p.status === 'open' && p.is_confirmed) || [];
  const openPlans = plans?.filter((p) => p.status === 'open' && !p.is_confirmed) || [];
  const cancelledPlans = plans?.filter((p) => p.status === 'cancelled') || [];

  return (
    <>
      <Stack.Screen
        options={{
          title: group?.name || 'Group',
          headerTitleStyle: { color: COLORS.gray[900] },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
          ),
          headerRight: () =>
            isAdmin ? (
              <TouchableOpacity onPress={() => router.push(`/(app)/group/${id}/settings`)}>
                <Text style={styles.headerButton}>⚙️</Text>
              </TouchableOpacity>
            ) : null,
        }}
      />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={groupLoading || plansLoading}
              onRefresh={refetch}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Group Header */}
          <View style={styles.header}>
            {group?.description && (
              <Text style={styles.description}>{group.description}</Text>
            )}
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.headerAction}
                onPress={() => router.push(`/(app)/group/${id}/members`)}
              >
                <Text style={styles.headerActionEmoji}>👥</Text>
                <Text style={styles.headerActionText}>{memberCount} members</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.headerAction} onPress={shareInviteCode}>
                <Text style={styles.headerActionEmoji}>🔗</Text>
                <Text style={styles.headerActionText}>Invite</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Create Plan Button */}
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push({ pathname: '/(app)/plan/create', params: { groupId: id } })}
          >
            <Text style={styles.createButtonEmoji}>➕</Text>
            <Text style={styles.createButtonText}>Create Plan</Text>
          </TouchableOpacity>

          {/* Confirmed Plans - Show first since they're most important */}
          {confirmedPlans.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitleConfirmed}>Confirmed Plans</Text>
                <View style={styles.confirmedBadge}>
                  <Text style={styles.confirmedBadgeText}>{confirmedPlans.length}</Text>
                </View>
              </View>
              <View style={styles.planList}>
                {confirmedPlans.map((plan) => (
                  <TouchableOpacity
                    key={plan.id}
                    style={styles.planCardConfirmed}
                    onPress={() => router.push(`/(app)/plan/${plan.id}`)}
                  >
                    <View style={styles.confirmedIndicator} />
                    <View style={styles.planCardContent}>
                      <View style={styles.planHeader}>
                        <Text style={styles.planType}>🎉</Text>
                        <Text style={styles.planTitle}>{plan.title}</Text>
                      </View>
                      <Text style={styles.planDateConfirmed}>
                        {getBestDate(plan)
                          ? new Date(getBestDate(plan)).toLocaleDateString('en-US', {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })
                          : 'Date TBD'}
                      </Text>
                      {plan.location && (
                        <Text style={styles.planLocation}>📍 {plan.location}</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Open Plans */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Open Plans ({openPlans.length})</Text>
            {openPlans.length > 0 ? (
              <View style={styles.planList}>
                {openPlans.map((plan) => (
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
                    {plan.event_date && (
                      <Text style={styles.planDate}>
                        {new Date(plan.event_date).toLocaleDateString()}
                      </Text>
                    )}
                    {plan.location && (
                      <Text style={styles.planLocation}>📍 {plan.location}</Text>
                    )}
                    <Text style={styles.planMeta}>
                      Min {plan.min_people} people
                      {plan.max_people && ` • Max ${plan.max_people}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No open plans</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </>
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
  headerButton: {
    fontSize: 20,
    padding: 8,
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backButtonText: {
    fontSize: 17,
    color: COLORS.primary,
  },
  header: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  description: {
    fontSize: 14,
    color: COLORS.gray[600],
    marginBottom: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  headerAction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.gray[50],
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  headerActionEmoji: {
    fontSize: 16,
  },
  headerActionText: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray[700],
  },
  createButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  createButtonEmoji: {
    fontSize: 20,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    marginBottom: 12,
  },
  sectionTitleConfirmed: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.success,
  },
  confirmedBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  confirmedBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  planList: {
    gap: 12,
  },
  planCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  planCardConfirmed: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  confirmedIndicator: {
    width: 4,
    backgroundColor: COLORS.success,
  },
  planCardContent: {
    flex: 1,
    padding: 16,
  },
  planDateConfirmed: {
    fontSize: 14,
    color: COLORS.success,
    fontWeight: '600',
    marginBottom: 4,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  planType: {
    fontSize: 20,
  },
  planTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    flex: 1,
  },
  planDate: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '500',
    marginBottom: 4,
  },
  planLocation: {
    fontSize: 14,
    color: COLORS.gray[500],
    marginBottom: 4,
  },
  planMeta: {
    fontSize: 12,
    color: COLORS.gray[400],
  },
  emptyState: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.gray[500],
  },
});
