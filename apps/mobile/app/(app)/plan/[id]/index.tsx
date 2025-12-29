import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { useLocalSearchParams, Stack, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, DateData } from 'react-native-calendars';
import { supabase } from '../../../../lib/supabase';
import { useAuthStore } from '../../../../stores/authStore';
import { COLORS } from '../../../../constants/colors';
import type { Plan, RsvpWithProfile, PlanDateOption, DateAvailability } from '@planazo/shared';

export default function PlanDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
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
      // Also refresh group plans list so confirmed status updates there
      if (plan?.group_id) {
        queryClient.invalidateQueries({ queryKey: ['group-plans', plan.group_id] });
      }
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

  // For fixed plans: check RSVP count
  // For flexible plans: check if any date option has enough people
  const isFixedConfirmed = plan?.plan_type === 'fixed' && yesCount >= (plan?.min_people || 2);
  const isFlexibleConfirmed = plan?.plan_type === 'flexible' && dateOptions?.some((option) => {
    const count = availabilities?.filter((a) => a.date_option_id === option.id).length || 0;
    return count >= (plan?.min_people || 2);
  });
  const isConfirmed = isFixedConfirmed || isFlexibleConfirmed;
  const isCancelled = plan?.status === 'cancelled';

  // Find the best date for flexible plans (most availability that meets minimum)
  const bestFlexibleDate = plan?.plan_type === 'flexible' && dateOptions
    ? dateOptions
        .map((option) => ({
          option,
          count: availabilities?.filter((a) => a.date_option_id === option.id).length || 0,
        }))
        .filter((d) => d.count >= (plan?.min_people || 2))
        .sort((a, b) => b.count - a.count)[0]
    : null;

  const getStatusBadge = () => {
    if (isCancelled) return { text: 'Cancelled', color: COLORS.error };
    if (isConfirmed) return { text: 'Confirmed!', color: COLORS.success };
    return { text: 'Open', color: COLORS.primary };
  };

  const status = getStatusBadge();

  // Calendar theme
  const calendarTheme = {
    backgroundColor: COLORS.white,
    calendarBackground: COLORS.white,
    textSectionTitleColor: COLORS.gray[500],
    todayTextColor: COLORS.gray[900],
    dayTextColor: COLORS.gray[300],
    textDisabledColor: COLORS.gray[200],
    arrowColor: COLORS.primary,
    monthTextColor: COLORS.gray[900],
    textDayFontWeight: '500' as const,
    textMonthFontWeight: '600' as const,
    textDayHeaderFontWeight: '500' as const,
  };

  // Build marked dates for flexible plan calendar
  const getFlexibleMarkedDates = () => {
    if (!dateOptions || !plan) return {};

    const marked: Record<string, any> = {};
    const dateOptionMap = new Map<string, PlanDateOption>();

    // Map date strings to date options
    dateOptions.forEach((option) => {
      const dateStr = option.date.split('T')[0];
      dateOptionMap.set(dateStr, option);
    });

    dateOptions.forEach((option) => {
      const dateStr = option.date.split('T')[0];
      const optionAvailabilities = availabilities?.filter(
        (a) => a.date_option_id === option.id
      ) || [];
      const count = optionAvailabilities.length;
      const userAvailable = optionAvailabilities.some((a) => a.user_id === user?.id);
      const meetsMinimum = count >= plan.min_people;

      // Color based on availability count
      let dotColor = COLORS.gray[300];
      let selectedColor = COLORS.gray[100];

      if (count > 0) {
        const ratio = Math.min(count / plan.min_people, 1);
        if (meetsMinimum) {
          selectedColor = COLORS.success;
          dotColor = COLORS.success;
        } else if (ratio >= 0.5) {
          selectedColor = COLORS.warning;
          dotColor = COLORS.warning;
        } else {
          selectedColor = COLORS.primary + '40';
          dotColor = COLORS.primary;
        }
      }

      marked[dateStr] = {
        selected: true,
        selectedColor: userAvailable ? COLORS.primary : selectedColor,
        selectedTextColor: userAvailable ? COLORS.white : COLORS.gray[900],
        marked: count > 0,
        dotColor: dotColor,
        customStyles: {
          container: {
            borderWidth: userAvailable ? 0 : 2,
            borderColor: count > 0 ? dotColor : COLORS.gray[300],
          },
        },
      };
    });

    return marked;
  };

  // Handle calendar day press for flexible plans
  const handleFlexibleDayPress = (day: DateData) => {
    if (isCancelled) return;

    const dateOption = dateOptions?.find((opt) => opt.date.split('T')[0] === day.dateString);
    if (dateOption) {
      toggleAvailability.mutate(dateOption.id);
    }
  };

  // Get availability info for a date
  const getDateAvailabilityInfo = (dateStr: string) => {
    const dateOption = dateOptions?.find((opt) => opt.date.split('T')[0] === dateStr);
    if (!dateOption) return null;

    const optionAvailabilities = availabilities?.filter(
      (a) => a.date_option_id === dateOption.id
    ) || [];

    return {
      count: optionAvailabilities.length,
      users: optionAvailabilities.map((a) => a.profile),
      meetsMinimum: optionAvailabilities.length >= (plan?.min_people || 2),
      userAvailable: optionAvailabilities.some((a) => a.user_id === user?.id),
    };
  };

  if (isLoading || !plan) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: plan.title,
          headerTitleStyle: { color: COLORS.gray[900] },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backButtonText}>‹ Back</Text>
            </TouchableOpacity>
          ),
        }}
      />
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

        {/* Fixed Plan RSVP - still allow RSVPs even when confirmed */}
        {plan.plan_type === 'fixed' && !isCancelled && (
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

        {/* Flexible Plan Date Options - Calendar View */}
        {plan.plan_type === 'flexible' && dateOptions && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Your Available Dates</Text>
            <Text style={styles.hint}>Tap highlighted dates to mark yourself available</Text>

            {/* Legend */}
            <View style={styles.calendarLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.primary }]} />
                <Text style={styles.legendText}>You're available</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
                <Text style={styles.legendText}>Min reached</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: COLORS.warning }]} />
                <Text style={styles.legendText}>Almost there</Text>
              </View>
            </View>

            {/* Calendar */}
            <View style={styles.calendarContainer}>
              <Calendar
                theme={calendarTheme}
                markedDates={getFlexibleMarkedDates()}
                onDayPress={handleFlexibleDayPress}
                enableSwipeMonths
                disableAllTouchEventsForDisabledDays
              />
            </View>

            {/* Date Details List */}
            <View style={styles.dateDetailsList}>
              <Text style={styles.dateDetailsTitle}>Date Details</Text>
              {dateOptions.map((option) => {
                const dateStr = option.date.split('T')[0];
                const info = getDateAvailabilityInfo(dateStr);
                if (!info) return null;

                return (
                  <TouchableOpacity
                    key={option.id}
                    style={[
                      styles.dateDetailItem,
                      info.userAvailable && styles.dateDetailItemSelected,
                      info.meetsMinimum && styles.dateDetailItemReady,
                    ]}
                    onPress={() => !isCancelled && toggleAvailability.mutate(option.id)}
                    disabled={isCancelled || toggleAvailability.isPending}
                  >
                    <View style={styles.dateDetailLeft}>
                      <Text style={[
                        styles.dateDetailDate,
                        info.userAvailable && styles.dateDetailDateSelected,
                      ]}>
                        {new Date(option.date).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                      {info.users.length > 0 && (
                        <View style={styles.dateDetailAvatars}>
                          {info.users.slice(0, 4).map((profile, idx) => (
                            <View
                              key={idx}
                              style={[
                                styles.miniAvatar,
                                { marginLeft: idx > 0 ? -8 : 0 },
                              ]}
                            >
                              <Text style={styles.miniAvatarText}>
                                {profile.display_name[0]}
                              </Text>
                            </View>
                          ))}
                          {info.users.length > 4 && (
                            <Text style={styles.moreUsers}>+{info.users.length - 4}</Text>
                          )}
                        </View>
                      )}
                    </View>
                    <View style={styles.dateDetailRight}>
                      <Text style={[
                        styles.dateDetailCount,
                        info.meetsMinimum && styles.dateDetailCountReady,
                      ]}>
                        {info.count}/{plan.min_people}
                      </Text>
                      {info.userAvailable && <Text style={styles.checkmark}>✓</Text>}
                    </View>
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
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backButtonText: {
    fontSize: 17,
    color: COLORS.primary,
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
    marginLeft: 4,
  },
  // Calendar styles
  calendarLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendText: {
    fontSize: 11,
    color: COLORS.gray[500],
  },
  calendarContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.gray[200],
    marginBottom: 16,
  },
  // Date details list
  dateDetailsList: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
  },
  dateDetailsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 12,
  },
  dateDetailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.gray[100],
  },
  dateDetailItemSelected: {
    backgroundColor: COLORS.primary + '08',
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  dateDetailItemReady: {
    borderLeftWidth: 3,
    borderLeftColor: COLORS.success,
    marginLeft: -16,
    paddingLeft: 13,
  },
  dateDetailLeft: {
    flex: 1,
  },
  dateDetailRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateDetailDate: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.gray[900],
    marginBottom: 4,
  },
  dateDetailDateSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  dateDetailAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateDetailCount: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[400],
  },
  dateDetailCountReady: {
    color: COLORS.success,
  },
});
