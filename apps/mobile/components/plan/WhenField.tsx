import { useState } from 'react';
import { View, StyleSheet, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from 'react-native-reanimated';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, MonthCalendar } from '../ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

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

interface Props {
  /** YYYY-MM-DD days, sorted. One is a fixed plan, several is a vote. */
  dates: string[];
  onToggleDay: (iso: string) => void;
  /** HH:MM. Only asked for once the plan is down to a single day. */
  time: string;
  onTimeChange: (time: string) => void;
}

/**
 * "When": the calendar, the chips for what was picked, and the start time that
 * only a single-date plan needs.
 *
 * The picker's open state stays here — nothing outside this section can tell
 * whether the wheel is showing.
 */
export function WhenField({ dates, onToggleDay, time, onTimeChange }: Props) {
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Build Dates from components, never by parsing strings: Hermes and the
  // native picker can disagree on the UTC offset of a parsed date-time,
  // which showed up as the wheel sitting an hour off the pill.
  const timeAsDate = () => {
    const [h = 0, m = 0] = time.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  };

  const onPickerChange = (_event: unknown, picked?: Date) => {
    if (Platform.OS !== 'ios') setShowTimePicker(false);
    if (picked) {
      onTimeChange(
        `${String(picked.getHours()).padStart(2, '0')}:${String(picked.getMinutes()).padStart(2, '0')}`
      );
    }
  };

  const summary =
    dates.length === 0
      ? 'Pick a date, or a few, and let them vote.'
      : dates.length === 1
        ? `Fixed date · ${fmtLong(dates[0]!)}`
        : `${dates.length} options · everyone ticks what works`;

  return (
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

      <MonthCalendar selected={dates} onToggleDay={onToggleDay} />

      {dates.length > 0 ? (
        <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.chipWrap}>
          {dates.map((d) => (
            <Pressable
              key={d}
              onPress={() => onToggleDay(d)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${fmtShort(d)}`}
              testID={`chip-${d}`}
              style={styles.dateChip}
            >
              <ThemedText variant="bodyStrong" style={styles.chipLabel} color={colors.accentPressed}>
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
              onChange={onPickerChange}
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
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
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
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chipLabel: {
    fontSize: 14,
    lineHeight: 18,
  },
  // 34 (8 + 18 + 8) and it carries a "✕" — the only way to drop a date you
  // picked by mistake, and the smallest thing being asked to do it (PLA-40).
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
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
});
