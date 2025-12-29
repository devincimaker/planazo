import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, DateData } from 'react-native-calendars';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { COLORS } from '../../../constants/colors';
import type { PlanType } from '@planazo/shared';

export default function CreatePlanScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
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
      // Create the plan
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
      }

      return plan;
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['group-plans', groupId] });
      router.back();
      // Navigate to the new plan
      setTimeout(() => {
        router.push(`/(app)/plan/${plan.id}`);
      }, 100);
    },
    onError: (error) => {
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
    (planType === 'fixed' ? selectedDate : flexibleDates.length > 0);

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
});
