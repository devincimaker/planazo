import { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { supabase } from '../../../lib/supabase';
import { useAuthStore } from '../../../stores/authStore';
import { ThemedText, Button, MonthCalendar, colorForName } from '../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../theme/tokens';
import { type } from '../../../theme/tokens';

const fmtShort = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
const fmtLong = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

export default function CreatePlanScreen() {
  // Beyond groupId, the params preseed sheet state so every state is
  // reachable by deep link (dev screenshots can't tap):
  //   planazo://plan/create?title=Padel&dates=2026-08-07,2026-08-09&min=5&cap=8&details=1
  const params = useLocalSearchParams<{
    groupId?: string;
    title?: string;
    dates?: string;
    time?: string;
    min?: string;
    cap?: string;
    details?: string;
    y?: string;
  }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [title, setTitle] = useState(params.title ?? '');
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>(() =>
    params.dates ? params.dates.split(',').filter(Boolean).sort() : []
  );
  const [time, setTime] = useState(params.time ?? '20:30');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [min, setMin] = useState(() => Math.min(20, Math.max(2, Number(params.min) || 4)));
  const [cap, setCap] = useState<number | null>(() =>
    Number(params.cap) > 0 ? Number(params.cap) : null
  );
  const [detailsOpen, setDetailsOpen] = useState(params.details === '1');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const { data: groups } = useQuery({
    queryKey: ['my-groups', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('group_members')
        .select('groups:group_id (id, name)')
        .eq('user_id', user!.id);
      if (error) throw error;
      return (data ?? [])
        .map((row) => row.groups as unknown as { id: string; name: string } | null)
        .filter(Boolean) as { id: string; name: string }[];
    },
    enabled: !!user,
  });

  // Opened from a group: that group is settled and the chip row collapses to it.
  const paramGroupId = params.groupId || null;
  const choices = paramGroupId
    ? (groups ?? []).filter((g) => g.id === paramGroupId)
    : (groups ?? []);
  const groupId = paramGroupId ?? pickedGroupId ?? choices[0]?.id ?? null;
  const group = choices.find((g) => g.id === groupId) ?? null;

  const toggleDay = (iso: string) =>
    setDates((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort()));

  const stepMin = (delta: 1 | -1) => {
    const next = Math.min(20, Math.max(2, min + delta));
    // The ceiling may equal the floor ("exactly N people" is a valid plan),
    // so a climbing floor drags the cap along to match, never past it
    if (cap !== null && cap < next) setCap(next);
    setMin(next);
  };
  const capUp = () => setCap((c) => (c === null ? min : Math.min(40, c + 1)));
  const capDown = () => setCap((c) => (c === null || c - 1 < min ? null : c - 1));

  // Build Dates from components, never by parsing strings: Hermes and the
  // native picker can disagree on the UTC offset of a parsed date-time,
  // which showed up as the wheel sitting an hour off the pill.
  const timeAsDate = () => {
    const [h, m] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };

  const eventDateIso = () => {
    const [y, mo, d] = dates[0].split('-').map(Number);
    const [h, m] = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, m).toISOString();
  };

  const onTimeChange = (_event: unknown, picked?: Date) => {
    if (Platform.OS !== 'ios') setShowTimePicker(false);
    if (picked) {
      setTime(
        `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`
      );
    }
  };

  const summary =
    dates.length === 0
      ? 'Pick a date — or a few, and let them vote.'
      : dates.length === 1
        ? `Fixed date · ${fmtLong(dates[0])}`
        : `${dates.length} options · everyone ticks what works`;

  const isValid = title.trim().length > 0 && dates.length > 0 && !!groupId;

  const createPlan = useMutation({
    mutationFn: async () => {
      if (!groupId || !user) throw new Error('Pick a group first');
      const fixed = dates.length === 1;

      const { data: plan, error } = await supabase
        .from('plans')
        .insert({
          group_id: groupId,
          created_by: user.id,
          title: title.trim(),
          description: notes.trim() || null,
          location: location.trim() || null,
          plan_type: fixed ? 'fixed' : 'flexible',
          event_date: fixed ? eventDateIso() : null,
          min_people: min,
          max_people: cap,
          status: 'open',
        })
        .select()
        .single();
      if (error) throw error;

      if (!fixed) {
        const { error: datesError } = await supabase
          .from('plan_date_options')
          .insert(dates.map((d) => ({ plan_id: plan.id, date: new Date(d).toISOString() })));
        if (datesError) throw datesError;
      }
      return plan;
    },
    onSuccess: (plan) => {
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      queryClient.invalidateQueries({ queryKey: ['group-plans', groupId] });
      router.back();
      setTimeout(() => router.push(`/(app)/plan/${plan.id}`), 100);
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="cancel">
          <ThemedText variant="bodyStrong" color={colors.textMuted}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>New plan</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          contentOffset={params.y ? { x: 0, y: Number(params.y) } : undefined}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.titleBlock}>
            <TextInput
              style={styles.titleInput}
              placeholder="Padel? Paella? Poker?"
              placeholderTextColor={colors.textFaint}
              value={title}
              onChangeText={setTitle}
              testID="title-input"
            />
            <View style={styles.rule} />
          </View>

          <View style={styles.section}>
            <ThemedText variant="sectionLabel">Who's it for</ThemedText>
            <View style={styles.chipWrap}>
              {choices.map((g) => {
                const active = g.id === groupId;
                return (
                  <Pressable
                    key={g.id}
                    onPress={() => setPickedGroupId(g.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    testID={`group-${g.id}`}
                    style={[styles.groupChip, active && styles.groupChipActive]}
                  >
                    <View style={[styles.groupDot, { backgroundColor: colorForName(g.name) }]} />
                    <ThemedText
                      variant="bodyStrong"
                      style={styles.chipLabel}
                      color={active ? colors.background : colors.textSecondary}
                    >
                      {g.name}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Animated.View layout={LinearTransition} style={styles.section}>
            <View style={styles.whenHeader}>
              <ThemedText variant="sectionLabel">When</ThemedText>
              <ThemedText
                variant="caption"
                color={dates.length ? colors.accent : colors.textMuted}
                style={styles.summary}
              >
                {summary}
              </ThemedText>
            </View>

            <MonthCalendar selected={dates} onToggleDay={toggleDay} />

            {dates.length > 0 ? (
              <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.chipWrap}>
                {dates.map((d) => (
                  <Pressable
                    key={d}
                    onPress={() => toggleDay(d)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${fmtShort(d)}`}
                    testID={`chip-${d}`}
                    style={styles.dateChip}
                  >
                    <ThemedText
                      variant="bodyStrong"
                      style={styles.chipLabel}
                      color={colors.accentPressed}
                    >
                      {fmtShort(d)}
                    </ThemedText>
                    <ThemedText
                      variant="bodyStrong"
                      style={[styles.chipLabel, styles.chipX]}
                      color={colors.accentPressed}
                    >
                      ✕
                    </ThemedText>
                  </Pressable>
                ))}
              </Animated.View>
            ) : null}

            {dates.length === 1 ? (
              <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.timeCard}>
                <View style={styles.timeRow}>
                  <ThemedText variant="bodyStrong">Starts at</ThemedText>
                  <Pressable
                    onPress={() => setShowTimePicker((s) => !s)}
                    accessibilityRole="button"
                    testID="time-pill"
                    style={styles.timePill}
                  >
                    <ThemedText style={styles.timeValue}>{time}</ThemedText>
                  </Pressable>
                </View>
                {showTimePicker ? (
                  <DateTimePicker
                    value={timeAsDate()}
                    mode="time"
                    display="spinner"
                    onChange={onTimeChange}
                  />
                ) : null}
              </Animated.View>
            ) : null}

            {dates.length > 1 ? (
              <Animated.View entering={FadeInDown} exiting={FadeOutUp}>
                <ThemedText variant="sub">You'll set the time once a date wins.</ThemedText>
              </Animated.View>
            ) : null}
          </Animated.View>

          <View style={styles.section}>
            <ThemedText variant="sectionLabel">How many</ThemedText>
            <View style={styles.howManyCard}>
              <View style={styles.stepperRow}>
                <ThemedText variant="body" style={styles.stepperCopy}>
                  Only happens if{'\n'}
                  <ThemedText variant="body" style={styles.strong}>
                    {min} people
                  </ThemedText>{' '}
                  are in
                </ThemedText>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={() => stepMin(-1)}
                    accessibilityRole="button"
                    accessibilityLabel="Fewer people needed"
                    testID="min-down"
                    style={styles.stepDown}
                  >
                    <ThemedText style={styles.stepLabel} color={colors.textSecondary}>
                      −
                    </ThemedText>
                  </Pressable>
                  <ThemedText style={styles.stepValue} testID="min-value">
                    {min}
                  </ThemedText>
                  <Pressable
                    onPress={() => stepMin(1)}
                    accessibilityRole="button"
                    accessibilityLabel="More people needed"
                    testID="min-up"
                    style={styles.stepUp}
                  >
                    <ThemedText style={styles.stepLabel} color={colors.background}>
                      +
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
              <View style={styles.hairline} />
              <View style={styles.stepperRow}>
                <ThemedText variant="body" style={styles.stepperCopy}>
                  Room for{'\n'}
                  <ThemedText
                    variant="body"
                    style={styles.strong}
                    color={cap ? colors.textPrimary : colors.textFaint}
                  >
                    {cap ?? 'No limit'}
                  </ThemedText>
                </ThemedText>
                <View style={styles.stepper}>
                  <Pressable
                    onPress={capDown}
                    accessibilityRole="button"
                    accessibilityLabel="Lower the cap"
                    testID="cap-down"
                    style={styles.stepDown}
                  >
                    <ThemedText style={styles.stepLabel} color={colors.textSecondary}>
                      −
                    </ThemedText>
                  </Pressable>
                  <ThemedText
                    style={styles.stepValue}
                    color={cap ? colors.textPrimary : colors.textFaint}
                    testID="cap-value"
                  >
                    {cap ?? '—'}
                  </ThemedText>
                  <Pressable
                    onPress={capUp}
                    accessibilityRole="button"
                    accessibilityLabel="Raise the cap"
                    testID="cap-up"
                    style={styles.stepUp}
                  >
                    <ThemedText style={styles.stepLabel} color={colors.background}>
                      +
                    </ThemedText>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Pressable
              onPress={() => setDetailsOpen((o) => !o)}
              accessibilityRole="button"
              testID="details-toggle"
              style={styles.detailsToggle}
            >
              <ThemedText variant="bodyStrong" color={colors.accent}>
                {detailsOpen ? 'Hide extras' : 'Add place & notes'}
              </ThemedText>
              <ThemedText variant="tag" color={colors.accent}>
                ▾
              </ThemedText>
            </Pressable>
            {detailsOpen ? (
              <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.detailsFields}>
                <TextInput
                  style={styles.input}
                  placeholder="Where's it happening?"
                  placeholderTextColor={colors.textFaint}
                  value={location}
                  onChangeText={setLocation}
                  testID="location-input"
                />
                <TextInput
                  style={[styles.input, styles.notes]}
                  placeholder="Anything they should know? Bring cash, wear trainers…"
                  placeholderTextColor={colors.textFaint}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  testID="notes-input"
                />
              </Animated.View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <Button
          label={createPlan.isPending ? 'Posting…' : `Post to ${group?.name ?? '…'}`}
          variant={isValid ? 'primary' : 'secondary'}
          disabled={!isValid || createPlan.isPending}
          haptic={isValid}
          onPress={() => createPlan.mutate()}
          testID="post-cta"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  headerSpacer: {
    width: 48,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: 6,
    paddingBottom: 130,
    gap: 22,
  },
  titleBlock: {
    gap: 10,
  },
  titleInput: {
    ...type.screenTitle,
    padding: 0,
  },
  rule: {
    height: 2,
    backgroundColor: colors.borderStrong,
  },
  section: {
    gap: 10,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chipLabel: {
    fontSize: 14,
    lineHeight: 18,
  },
  groupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  groupChipActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  groupDot: {
    width: 14,
    height: 14,
    borderRadius: 5,
  },
  whenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  summary: {
    flexShrink: 1,
    maxWidth: 250,
    textAlign: 'right',
  },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  chipX: {
    opacity: 0.6,
  },
  timeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: spacing.sm,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  timePill: {
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  timeValue: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  howManyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    overflow: 'hidden',
  },
  stepperRow: {
    padding: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepperCopy: {
    flexShrink: 1,
  },
  strong: {
    fontFamily: fonts.bodyBold,
  },
  hairline: {
    height: 1,
    backgroundColor: colors.divider,
    marginHorizontal: spacing.lg,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepDown: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  stepUp: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },
  stepLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 20,
    lineHeight: 24,
  },
  stepValue: {
    width: 44,
    textAlign: 'center',
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  detailsFields: {
    gap: 10,
  },
  input: {
    ...type.body,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    padding: 15,
  },
  notes: {
    height: 88,
    textAlignVertical: 'top',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 30,
  },
});
