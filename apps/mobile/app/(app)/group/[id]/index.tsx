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
      const { data, error } = await supabase
        .from('plans')
        .select('*')
        .eq('group_id', id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Plan[];
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

  const openPlans = plans?.filter((p) => p.status === 'open') || [];
  const lockedPlans = plans?.filter((p) => p.status === 'locked') || [];
  const pastPlans = plans?.filter((p) => p.status === 'cancelled') || [];

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

          {/* Locked Plans */}
          {lockedPlans.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Happening! ({lockedPlans.length})</Text>
              <View style={styles.planList}>
                {lockedPlans.map((plan) => (
                  <TouchableOpacity
                    key={plan.id}
                    style={[styles.planCard, styles.planCardLocked]}
                    onPress={() => router.push(`/(app)/plan/${plan.id}`)}
                  >
                    <View style={styles.planHeader}>
                      <Text style={styles.planType}>🎉</Text>
                      <Text style={styles.planTitle}>{plan.title}</Text>
                    </View>
                    <Text style={styles.planDate}>
                      {new Date(plan.locked_date || plan.event_date || '').toLocaleDateString()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    marginBottom: 12,
  },
  planList: {
    gap: 12,
  },
  planCard: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  planCardLocked: {
    borderWidth: 2,
    borderColor: COLORS.success,
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
