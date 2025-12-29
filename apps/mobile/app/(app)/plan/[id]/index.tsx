import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { COLORS } from '../../../../constants/colors';
import type { Plan, RsvpWithProfile, PlanDateOption, DateAvailability } from '@planazo/shared';

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();

  const { data: plan, isLoading, refetch } = useQuery({
    queryKey: ['plan', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plans')
        .select(`
          *,
          creator:profiles!plans_created_by_fkey(*)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Plan & { creator: any };
    },
    enabled: !!id,
  });

  const { data: rsvps } = useQuery({
    queryKey: ['plan-rsvps', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rsvps')
        .select(`
          *,
          profile:profiles(*)
        `)
        .eq('plan_id', id);

      if (error) throw error;
      return data as RsvpWithProfile[];
    },
    enabled: !!id && plan?.plan_type === 'fixed',
  });

  const { data: dateOptions } = useQuery({
    queryKey: ['plan-date-options', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plan_date_options')
        .select('*')
        .eq('plan_id', id)
        .order('date', { ascending: true });

      if (error) throw error;
      return data as PlanDateOption[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const { data: availabilities } = useQuery({
    queryKey: ['plan-availabilities', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('date_availability')
        .select(`
          *,
          profile:profiles(*)
        `)
        .eq('plan_id', id);

      if (error) throw error;
      return data as (DateAvailability & { profile: any })[];
    },
    enabled: !!id && plan?.plan_type === 'flexible',
  });

  const userRsvp = rsvps?.find((r) => r.user_id === user?.id);

  const updateRsvp = useMutation({
    mutationFn: async (response: 'yes' | 'no') => {
      if (userRsvp) {
        const { error } = await supabase
          .from('rsvps')
          .update({ response })
          .eq('id', userRsvp.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('rsvps').insert({
          plan_id: id,
          user_id: user?.id,
          response,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-rsvps', id] });
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const toggleAvailability = useMutation({
    mutationFn: async (dateOptionId: string) => {
      const existing = availabilities?.find(
        (a) => a.date_option_id === dateOptionId && a.user_id === user?.id
      );

      if (existing) {
        const { error } = await supabase
          .from('date_availability')
          .delete()
          .eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('date_availability').insert({
          plan_id: id,
          user_id: user?.id,
          date_option_id: dateOptionId,
          available: true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-availabilities', id] });
    },
    onError: (error) => {
      Alert.alert('Error', error.message);
    },
  });

  const yesCount = rsvps?.filter((r) => r.response === 'yes').length ?? 0;
  const isLocked = plan?.status === 'locked';
  const isCancelled = plan?.status === 'cancelled';

  const getStatusBadge = () => {
    if (isLocked) return { text: 'Happening!', color: COLORS.success };
    if (isCancelled) return { text: 'Cancelled', color: COLORS.error };
    return { text: 'Open', color: COLORS.primary };
  };

  const status = getStatusBadge();

  if (isLoading || !plan) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: plan.title }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={COLORS.primary} />
        }
      >
        {/* Status Badge */}
        <View style={[styles.statusBadge, { backgroundColor: status.color }]}>
          <Text style={styles.statusText}>{status.text}</Text>
        </View>

        {/* Plan Info */}
        <View style={styles.card}>
          <View style={styles.planHeader}>
            <Text style={styles.planType}>
              {plan.plan_type === 'fixed' ? '📅 Fixed Date' : '🗓️ Flexible'}
            </Text>
          </View>

          <Text style={styles.title}>{plan.title}</Text>

          {plan.description && (
            <Text style={styles.description}>{plan.description}</Text>
          )}

          {plan.location && (
            <View style={styles.infoRow}>
              <Text style={styles.infoEmoji}>📍</Text>
              <Text style={styles.infoText}>{plan.location}</Text>
            </View>
          )}

          {(plan.event_date || plan.locked_date) && (
            <View style={styles.infoRow}>
              <Text style={styles.infoEmoji}>🗓️</Text>
              <Text style={styles.infoText}>
                {new Date(plan.locked_date || plan.event_date || '').toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
            </View>
          )}

          <View style={styles.infoRow}>
            <Text style={styles.infoEmoji}>👥</Text>
            <Text style={styles.infoText}>
              Min {plan.min_people} people
              {plan.max_people && ` • Max ${plan.max_people}`}
            </Text>
          </View>

          <Text style={styles.creator}>
            Created by {plan.creator?.display_name || 'Unknown'}
          </Text>
        </View>

        {/* Fixed Plan RSVP */}
        {plan.plan_type === 'fixed' && !isLocked && !isCancelled && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Your Response</Text>
            <View style={styles.rsvpButtons}>
              <TouchableOpacity
                style={[
                  styles.rsvpButton,
                  userRsvp?.response === 'yes' && styles.rsvpButtonActive,
                ]}
                onPress={() => updateRsvp.mutate('yes')}
                disabled={updateRsvp.isPending}
              >
                <Text style={styles.rsvpEmoji}>✅</Text>
                <Text
                  style={[
                    styles.rsvpText,
                    userRsvp?.response === 'yes' && styles.rsvpTextActive,
                  ]}
                >
                  I'm in!
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.rsvpButton,
                  userRsvp?.response === 'no' && styles.rsvpButtonNo,
                ]}
                onPress={() => updateRsvp.mutate('no')}
                disabled={updateRsvp.isPending}
              >
                <Text style={styles.rsvpEmoji}>❌</Text>
                <Text
                  style={[
                    styles.rsvpText,
                    userRsvp?.response === 'no' && styles.rsvpTextActive,
                  ]}
                >
                  Can't make it
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Fixed Plan Attendees */}
        {plan.plan_type === 'fixed' && rsvps && rsvps.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              Attendees ({yesCount}/{plan.min_people} min)
            </Text>
            <View style={styles.attendeeList}>
              {rsvps
                .filter((r) => r.response === 'yes')
                .map((rsvp) => (
                  <View key={rsvp.id} style={styles.attendee}>
                    <View style={styles.attendeeAvatar}>
                      <Text style={styles.attendeeAvatarText}>
                        {rsvp.profile.display_name[0].toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.attendeeName}>{rsvp.profile.display_name}</Text>
                  </View>
                ))}
            </View>
          </View>
        )}

        {/* Flexible Plan Date Options */}
        {plan.plan_type === 'flexible' && dateOptions && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Your Available Dates</Text>
            <Text style={styles.hint}>Tap dates when you're available</Text>
            <View style={styles.dateOptionList}>
              {dateOptions.map((option) => {
                const optionAvailabilities = availabilities?.filter(
                  (a) => a.date_option_id === option.id
                ) || [];
                const userAvailable = optionAvailabilities.some(
                  (a) => a.user_id === user?.id
                );
                const count = optionAvailabilities.length;
                const meetsMinimum = count >= plan.min_people;

                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.dateOption,
                      userAvailable && styles.dateOptionSelected,
                      meetsMinimum && styles.dateOptionReady,
                    ]}
                    onPress={() => !isLocked && !isCancelled && toggleAvailability.mutate(option.id)}
                    disabled={isLocked || isCancelled || toggleAvailability.isPending}
                  >
                    <View style={styles.dateOptionHeader}>
                      <Text style={styles.dateOptionDate}>
                        {new Date(option.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                      {userAvailable && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <Text style={[styles.dateOptionCount, meetsMinimum && styles.dateOptionCountReady]}>
                      {count}/{plan.min_people} available
                    </Text>
                    {optionAvailabilities.length > 0 && (
                      <View style={styles.availableUsers}>
                        {optionAvailabilities.slice(0, 5).map((a) => (
                          <View key={a.id} style={styles.miniAvatar}>
                            <Text style={styles.miniAvatarText}>
                              {a.profile.display_name[0]}
                            </Text>
                          </View>
                        ))}
                        {optionAvailabilities.length > 5 && (
                          <Text style={styles.moreUsers}>
                            +{optionAvailabilities.length - 5}
                          </Text>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
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
  loadingText: {
    textAlign: 'center',
    marginTop: 32,
    color: COLORS.gray[500],
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 16,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.white,
  },
  card: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  planHeader: {
    marginBottom: 12,
  },
  planType: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.gray[500],
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.gray[900],
    marginBottom: 8,
  },
  description: {
    fontSize: 16,
    color: COLORS.gray[600],
    marginBottom: 16,
    lineHeight: 24,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoEmoji: {
    fontSize: 16,
    marginRight: 8,
  },
  infoText: {
    fontSize: 14,
    color: COLORS.gray[700],
  },
  creator: {
    fontSize: 12,
    color: COLORS.gray[400],
    marginTop: 12,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginBottom: 12,
  },
  rsvpButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  rsvpButton: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  rsvpButtonActive: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '10',
  },
  rsvpButtonNo: {
    borderColor: COLORS.error,
    backgroundColor: COLORS.error + '10',
  },
  rsvpEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  rsvpText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[700],
  },
  rsvpTextActive: {
    color: COLORS.gray[900],
  },
  attendeeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attendee: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  attendeeAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeeAvatarText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  attendeeName: {
    fontSize: 14,
    color: COLORS.gray[700],
  },
  dateOptionList: {
    gap: 12,
  },
  dateOption: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 16,
  },
  dateOptionSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  dateOptionReady: {
    borderColor: COLORS.success,
  },
  dateOptionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dateOptionDate: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[900],
  },
  checkmark: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  dateOptionCount: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginBottom: 8,
  },
  dateOptionCountReady: {
    color: COLORS.success,
    fontWeight: '600',
  },
  availableUsers: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.gray[300],
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniAvatarText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.white,
  },
  moreUsers: {
    fontSize: 10,
    color: COLORS.gray[500],
  },
});
