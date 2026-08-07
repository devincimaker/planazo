import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from './ThemedText';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { buildMonthGrid, isoOfDate } from '../../lib/monthGrid';
import { colors, fonts } from '../../theme/tokens';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
// How far ahead the month arrows can go (design: half a year of runway)
const MAX_MONTHS_AHEAD = 5;

interface MonthCalendarProps {
  /** Picked days as YYYY-MM-DD */
  selected: string[];
  onToggleDay: (iso: string) => void;
}

/** Month grid from design 5a: tap days to pick them, past days are dead. */
export function MonthCalendar({ selected, onToggleDay }: MonthCalendarProps) {
  const [offset, setOffset] = useState(0);

  const now = new Date();
  const today = isoOfDate(now);
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const weeks = buildMonthGrid(base.getFullYear(), base.getMonth());

  const label = base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setOffset((o) => Math.max(0, o - 1))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          testID="cal-prev"
          style={styles.arrow}
        >
          <ThemedText color={colors.accent} style={styles.arrowLabel}>
            ‹
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.monthLabel}>{label}</ThemedText>
        <Pressable
          onPress={() => setOffset((o) => Math.min(MAX_MONTHS_AHEAD, o + 1))}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          testID="cal-next"
          style={styles.arrow}
        >
          <ThemedText color={colors.accent} style={styles.arrowLabel}>
            ›
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.week}>
        {DOW.map((d, i) => (
          <ThemedText key={`dow-${i}`} style={styles.dow}>
            {d}
          </ThemedText>
        ))}
      </View>

      <View style={styles.grid}>
        {weeks.map((week, wi) => (
          <View key={`w-${wi}`} style={styles.week}>
            {week.map((cell) => {
              if (!cell.iso) return <View key={cell.key} style={styles.day} />;
              const past = cell.iso < today;
              const on = selected.includes(cell.iso);
              const isToday = cell.iso === today;
              return (
                <Pressable
                  key={cell.key}
                  onPress={() => onToggleDay(cell.iso!)}
                  disabled={past}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: past }}
                  testID={`cal-day-${cell.iso}`}
                  style={[styles.day, on && styles.dayOn]}
                >
                  <ThemedText
                    style={[styles.dayLabel, (on || isToday) && styles.dayLabelBold]}
                    color={
                      on
                        ? colors.textOnAccent
                        : past
                          ? colors.textFaint
                          : isToday
                            ? colors.accent
                            : colors.textPrimary
                    }
                  >
                    {cell.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  // A chevron is about 12×24 — the smallest target in the app before this. The
  // box is a real 44×44 with the glyph centred in it; the negative margins give
  // back the surplus so the header row keeps its height and each chevron stays
  // exactly where it was drawn (the 16 is 6 of header padding + the 10 the
  // wider box would otherwise push it in by).
  arrow: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: -10,
    marginHorizontal: -16,
  },
  arrowLabel: {
    fontSize: 20,
    lineHeight: 24,
  },
  monthLabel: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  // No row gap: the 2pt that used to separate the weeks now belongs to the day
  // cells themselves, which takes each one from 42 to 44 without the grid
  // growing by a single point (the row pitch was, and stays, 44). Real boxes
  // sitting flush cannot overlap the way two hitSlop regions would.
  grid: {
    gap: 0,
  },
  week: {
    flexDirection: 'row',
    gap: 2,
  },
  dow: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    lineHeight: 15,
    color: colors.textFaint,
    paddingBottom: 4,
  },
  day: {
    flex: 1,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  dayOn: {
    backgroundColor: colors.accent,
  },
  dayLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 19,
  },
  dayLabelBold: {
    fontFamily: fonts.bodyBold,
  },
});
