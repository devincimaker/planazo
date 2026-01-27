import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { Calendar, DateData } from 'react-native-calendars';
import { supabase } from '../../../lib/supabase';
import { api } from '../../../lib/api';
import { useAuthStore } from '../../../stores/authStore';
import { COLORS } from '../../../constants/colors';
import type { PlanType, FriendsResponse } from '@planazo/shared';

export default function CreatePlanScreen() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [planType, setPlanType] = useState<PlanType>('fixed');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [minPeople, setMinPeople] = useState('2');
  const [maxPeople, setMaxPeople] = useState('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [flexibleDates, setFlexibleDates] = useState<string[]>([]);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);

  // Fetch friends for groupless plans
  const { data: friendsData } = useQuery<FriendsResponse>({
    queryKey: ['friends'],
    queryFn: () => api.friends.list(),
    enabled: !groupId, // Only fetch if creating groupless plan
  });

  const friends = friendsData?.friends || [];

  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split('T')[0];

  // Calendar theme matching app colors
  const calendarTheme = {
    backgroundColor: COLORS.white,
    calendarBackground: COLORS.white,
    textSectionTitleColor: COLORS.gray[500],
    selectedDayBackgroundColor: COLORS.primary,
    selectedDayTextColor: COLORS.white,
    todayTextColor: COLORS.primary,
    dayTextColor: COLORS.gray[900],
    textDisabledColor: COLORS.gray[300],
    dotColor: COLORS.primary,
    selectedDotColor: COLORS.white,
    arrowColor: COLORS.primary,
    monthTextColor: COLORS.gray[900],
    textDayFontWeight: '500' as const,
    textMonthFontWeight: '600' as const,
    textDayHeaderFontWeight: '500' as const,
  };

  const createPlan = useMutation({
    mutationFn: async () => {
      // If groupless plan, use the API
      if (!groupId) {
        const plan = await api.plans.createGroupless({
          title: title.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          plan_type: planType,
          event_date: planType === 'fixed' && selectedDate ? new Date(selectedDate).toISOString() : undefined,
          date_options: planType === 'flexible' ? flexibleDates.map(d => new Date(d).toISOString()) : undefined,
          min_people: parseInt(minPeople) || 2,
          max_people: maxPeople ? parseInt(maxPeople) : undefined,
          invite_friend_ids: selectedFriendIds,
        });
        return plan;
      }

      // Group plan - use Supabase directly
      const { data: plan, error: planError } = await supabase
        .from('plans')
        .insert({
          group_id: groupId,
          created_by: user?.id,
          title: title.trim(),
          description: description.trim() || null,
          location: location.trim() || null,
          plan_type: planType,
          event_date: planType === 'fixed' && selectedDate ? new Date(selectedDate).toISOString() : null,
          min_people: parseInt(minPeople) || 2,
          max_people: maxPeople ? parseInt(maxPeople) : null,
          status: 'open',
        })
        .select()
        .single();

      if (planError) throw planError;

      // For flexible plans, add date options
      if (planType === 'flexible' && flexibleDates.length > 0) {
        const dateOptions = flexibleDates.map((dateStr) => ({
          plan_id: plan.id,
          date: new Date(dateStr).toISOString(),
        }));

        const { error: datesError } = await supabase
          .from('plan_date_options')
          .insert(dateOptions);

        if (datesError) throw datesError;

        // Auto-mark creator as available for all dates
        const { data: insertedDateOptions } = await supabase
          .from('plan_date_options')
          .select('id')
          .eq('plan_id', plan.id);

        if (insertedDateOptions) {
          const availabilities = insertedDateOptions.map((opt) => ({
            plan_id: plan.id,
            date_option_id: opt.id,
            user_id: user?.id,
            available: true,
          }));

          await supabase.from('date_availability').insert(availabilities);
        }
      } else {
        // For fixed plans, auto-RSVP creator as "yes"
        await supabase.from('rsvps').insert({
          plan_id: plan.id,
          user_id: user?.id,
          response: 'yes',
        });
      }

      return plan;
    },
    onSuccess: (plan) => {
      if (groupId) {
        queryClient.invalidateQueries({ queryKey: ['group-plans', groupId] });
      }
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      router.back();
      // Navigate to the new plan
      setTimeout(() => {
        router.push(`/(app)/plan/${plan.id}`);
      }, 100);
    },
    onError: (error: Error) => {
      Alert.alert('Error', error.message);
    },
  });

  function toggleFlexibleDate(dateString: string) {
    if (flexibleDates.includes(dateString)) {
      setFlexibleDates(flexibleDates.filter((d) => d !== dateString));
    } else {
      setFlexibleDates([...flexibleDates, dateString].sort());
    }
  }

  function removeFlexibleDate(dateString: string) {
    setFlexibleDates(flexibleDates.filter((d) => d !== dateString));
  }

  function toggleFriend(friendId: string) {
    if (selectedFriendIds.includes(friendId)) {
      setSelectedFriendIds(selectedFriendIds.filter((id) => id !== friendId));
    } else {
      setSelectedFriendIds([...selectedFriendIds, friendId]);
    }
  }

  // Build marked dates for calendar
  const getMarkedDates = () => {
    if (planType === 'fixed') {
      return selectedDate ? { [selectedDate]: { selected: true } } : {};
    } else {
      const marked: Record<string, any> = {};
      flexibleDates.forEach((date) => {
        marked[date] = { selected: true, selectedColor: COLORS.primary };
      });
      return marked;
    }
  };

  const isValid =
    title.trim() &&
    parseInt(minPeople) >= 2 &&
    (planType === 'fixed' ? selectedDate : flexibleDates.length > 0) &&
    (groupId || selectedFriendIds.length > 0); // Require friends for groupless plans

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Plan Type Selector */}
      <View style={styles.section}>
        <Text style={styles.label}>Plan Type</Text>
        <View style={styles.typeSelector}>
          <TouchableOpacity
            style={[styles.typeOption, planType === 'fixed' && styles.typeOptionActive]}
            onPress={() => setPlanType('fixed')}
          >
            <Text style={styles.typeEmoji}>📅</Text>
            <Text
              style={[styles.typeText, planType === 'fixed' && styles.typeTextActive]}
            >
              Fixed Date
            </Text>
            <Text style={styles.typeDescription}>Specific date event</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeOption, planType === 'flexible' && styles.typeOptionActive]}
            onPress={() => setPlanType('flexible')}
          >
            <Text style={styles.typeEmoji}>🗓️</Text>
            <Text
              style={[styles.typeText, planType === 'flexible' && styles.typeTextActive]}
            >
              Flexible
            </Text>
            <Text style={styles.typeDescription}>Multiple date options</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Title */}
      <View style={styles.section}>
        <Text style={styles.label}>Title *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g., Beach day, Paintball outing"
          value={title}
          onChangeText={setTitle}
        />
      </View>

      {/* Description */}
      <View style={styles.section}>
        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="What's the plan about?"
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={3}
        />
      </View>

      {/* Location */}
      <View style={styles.section}>
        <Text style={styles.label}>Location</Text>
        <TextInput
          style={styles.input}
          placeholder="Where will it happen?"
          value={location}
          onChangeText={setLocation}
        />
      </View>

      {/* Friend Selection - only for groupless plans */}
      {!groupId && (
        <View style={styles.section}>
          <Text style={styles.label}>Invite Friends *</Text>
          <Text style={styles.hint}>Select friends to invite to this plan</Text>
          {friends.length > 0 ? (
            <View style={styles.friendsList}>
              {friends.map((item) => (
                <TouchableOpacity
                  key={item.friend.id}
                  style={[
                    styles.friendItem,
                    selectedFriendIds.includes(item.friend.id) && styles.friendItemSelected,
                  ]}
                  onPress={() => toggleFriend(item.friend.id)}
                >
                  {item.friend.avatar_url ? (
                    <Image source={{ uri: item.friend.avatar_url }} style={styles.friendAvatar} />
                  ) : (
                    <View style={styles.friendAvatarPlaceholder}>
                      <Text style={styles.friendAvatarText}>
                        {item.friend.display_name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <Text style={[
                    styles.friendName,
                    selectedFriendIds.includes(item.friend.id) && styles.friendNameSelected,
                  ]}>
                    {item.friend.display_name}
                  </Text>
                  {selectedFriendIds.includes(item.friend.id) && (
                    <Text style={styles.checkmark}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <View style={styles.noFriendsState}>
              <Text style={styles.noFriendsText}>No friends yet</Text>
              <Text style={styles.noFriendsSubtext}>
                Add friends from the Friends tab first
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Date Selection - Calendar */}
      <View style={styles.section}>
        <Text style={styles.label}>
          {planType === 'fixed' ? 'Select Date *' : 'Select Available Dates *'}
        </Text>
        {planType === 'flexible' && (
          <Text style={styles.hint}>Tap multiple dates when this plan could happen</Text>
        )}

        <View style={styles.calendarContainer}>
          <Calendar
            theme={calendarTheme}
            minDate={today}
            markedDates={getMarkedDates()}
            onDayPress={(day: DateData) => {
              if (planType === 'fixed') {
                setSelectedDate(day.dateString);
              } else {
                toggleFlexibleDate(day.dateString);
              }
            }}
            enableSwipeMonths
          />
        </View>

        {/* Show selected dates for flexible plans */}
        {planType === 'flexible' && flexibleDates.length > 0 && (
          <View style={styles.selectedDatesContainer}>
            <Text style={styles.selectedDatesLabel}>
              Selected dates ({flexibleDates.length}):
            </Text>
            <View style={styles.dateList}>
              {flexibleDates.map((dateStr) => (
                <View key={dateStr} style={styles.dateChip}>
                  <Text style={styles.dateChipText}>
                    {new Date(dateStr).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                  <TouchableOpacity onPress={() => removeFlexibleDate(dateStr)}>
                    <Text style={styles.dateChipRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Show selected date for fixed plans */}
        {planType === 'fixed' && selectedDate && (
          <View style={styles.selectedDateDisplay}>
            <Text style={styles.selectedDateText}>
              {new Date(selectedDate).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </View>
        )}
      </View>

      {/* People Count */}
      <View style={styles.row}>
        <View style={[styles.section, styles.halfSection]}>
          <Text style={styles.label}>Min People *</Text>
          <TextInput
            style={styles.input}
            placeholder="2"
            value={minPeople}
            onChangeText={setMinPeople}
            keyboardType="number-pad"
          />
        </View>
        <View style={[styles.section, styles.halfSection]}>
          <Text style={styles.label}>Max People</Text>
          <TextInput
            style={styles.input}
            placeholder="No limit"
            value={maxPeople}
            onChangeText={setMaxPeople}
            keyboardType="number-pad"
          />
        </View>
      </View>

      {/* Submit Button */}
      <TouchableOpacity
        style={[styles.submitButton, !isValid && styles.submitButtonDisabled]}
        onPress={() => createPlan.mutate()}
        disabled={!isValid || createPlan.isPending}
      >
        <Text style={styles.submitButtonText}>
          {createPlan.isPending ? 'Creating...' : 'Create Plan'}
        </Text>
      </TouchableOpacity>
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
    paddingBottom: 40,
  },
  section: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 8,
  },
  hint: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginBottom: 12,
  },
  input: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.gray[900],
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
  },
  typeOption: {
    flex: 1,
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  typeOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.gray[50],
  },
  typeEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  typeText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 4,
  },
  typeTextActive: {
    color: COLORS.primary,
  },
  typeDescription: {
    fontSize: 12,
    color: COLORS.gray[500],
    textAlign: 'center',
  },
  calendarContainer: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.gray[200],
  },
  selectedDatesContainer: {
    marginTop: 16,
  },
  selectedDatesLabel: {
    fontSize: 12,
    color: COLORS.gray[500],
    marginBottom: 8,
  },
  dateList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  dateChipText: {
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '500',
  },
  dateChipRemove: {
    fontSize: 14,
    color: COLORS.white,
    opacity: 0.8,
  },
  selectedDateDisplay: {
    marginTop: 16,
    backgroundColor: COLORS.primary + '15',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
  },
  selectedDateText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfSection: {
    flex: 1,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  friendsList: {
    gap: 8,
  },
  friendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 12,
  },
  friendItemSelected: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  friendAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  friendAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  friendAvatarText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.white,
  },
  friendName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.gray[900],
  },
  friendNameSelected: {
    color: COLORS.primary,
  },
  checkmark: {
    fontSize: 18,
    color: COLORS.primary,
    fontWeight: '600',
  },
  noFriendsState: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
  },
  noFriendsText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.gray[700],
    marginBottom: 4,
  },
  noFriendsSubtext: {
    fontSize: 14,
    color: COLORS.gray[500],
    textAlign: 'center',
  },
});
