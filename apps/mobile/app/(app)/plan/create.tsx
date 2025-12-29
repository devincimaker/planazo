import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import DateTimePicker from '@react-native-community/datetimepicker';
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
  const [eventDate, setEventDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [flexibleDates, setFlexibleDates] = useState<Date[]>([]);
  const [tempDate, setTempDate] = useState(new Date());
  const [showFlexibleDatePicker, setShowFlexibleDatePicker] = useState(false);

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
          event_date: planType === 'fixed' ? eventDate.toISOString() : null,
          min_people: parseInt(minPeople) || 2,
          max_people: maxPeople ? parseInt(maxPeople) : null,
          status: 'open',
        })
        .select()
        .single();

      if (planError) throw planError;

      // For flexible plans, add date options
      if (planType === 'flexible' && flexibleDates.length > 0) {
        const dateOptions = flexibleDates.map((date) => ({
          plan_id: plan.id,
          date: date.toISOString(),
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

  function addFlexibleDate() {
    if (flexibleDates.some((d) => d.toDateString() === tempDate.toDateString())) {
      Alert.alert('Date already added');
      return;
    }
    setFlexibleDates([...flexibleDates, tempDate]);
    setShowFlexibleDatePicker(false);
    setTempDate(new Date());
  }

  function removeFlexibleDate(index: number) {
    setFlexibleDates(flexibleDates.filter((_, i) => i !== index));
  }

  const isValid =
    title.trim() &&
    parseInt(minPeople) >= 2 &&
    (planType === 'fixed' || flexibleDates.length > 0);

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

      {/* Date Selection */}
      {planType === 'fixed' ? (
        <View style={styles.section}>
          <Text style={styles.label}>Date *</Text>
          <TouchableOpacity
            style={styles.dateButton}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={styles.dateButtonText}>
              {eventDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={eventDate}
              mode="date"
              minimumDate={new Date()}
              onChange={(event, date) => {
                setShowDatePicker(Platform.OS === 'ios');
                if (date) setEventDate(date);
              }}
            />
          )}
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.label}>Available Dates *</Text>
          <Text style={styles.hint}>Add dates when this plan could happen</Text>

          {flexibleDates.length > 0 && (
            <View style={styles.dateList}>
              {flexibleDates.map((date, index) => (
                <View key={index} style={styles.dateChip}>
                  <Text style={styles.dateChipText}>
                    {date.toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Text>
                  <TouchableOpacity onPress={() => removeFlexibleDate(index)}>
                    <Text style={styles.dateChipRemove}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={styles.addDateButton}
            onPress={() => setShowFlexibleDatePicker(true)}
          >
            <Text style={styles.addDateButtonText}>+ Add Date</Text>
          </TouchableOpacity>

          {showFlexibleDatePicker && (
            <>
              <DateTimePicker
                value={tempDate}
                mode="date"
                minimumDate={new Date()}
                onChange={(event, date) => {
                  if (Platform.OS !== 'ios') {
                    setShowFlexibleDatePicker(false);
                    if (date && event.type === 'set') {
                      setTempDate(date);
                      if (!flexibleDates.some((d) => d.toDateString() === date.toDateString())) {
                        setFlexibleDates([...flexibleDates, date]);
                      }
                    }
                  } else if (date) {
                    setTempDate(date);
                  }
                }}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity style={styles.confirmDateButton} onPress={addFlexibleDate}>
                  <Text style={styles.confirmDateButtonText}>Add This Date</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}

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
  dateButton: {
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.gray[200],
    borderRadius: 12,
    padding: 16,
  },
  dateButtonText: {
    fontSize: 16,
    color: COLORS.gray[900],
  },
  dateList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
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
  addDateButton: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  addDateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  confirmDateButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  confirmDateButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
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
