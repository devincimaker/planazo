import { useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useCreatePlan } from '../../../lib/useCreatePlan';
import { useMyGroups } from '../../../lib/useMyGroups';
import { emptyPollDraft, pollDraftTouched, pollDraftValid } from '../../../lib/pollDraft';
import { PollComposer } from '../../../components/PollComposer';
import { WhenField } from '../../../components/plan/WhenField';
import { HowManyField } from '../../../components/plan/HowManyField';
import { NEEDS_GROUP_COPY, NeedsGroupState } from '../../../components/group/NeedsGroupState';
import { useDismissTo } from '../../../lib/navigation';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { ThemedText, Button, FooterBar, colorForName } from '../../../components/ui';
import { colors, fonts, radii, spacing } from '../../../theme/tokens';
import { type } from '../../../theme/tokens';

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
    location?: string;
    y?: string;
  }>();

  const [title, setTitle] = useState(params.title ?? '');
  const [pickedGroupId, setPickedGroupId] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>(() =>
    params.dates ? params.dates.split(',').filter(Boolean).sort() : []
  );
  const [time, setTime] = useState(params.time ?? '20:30');
  const [min, setMin] = useState(() => Math.min(20, Math.max(2, Number(params.min) || 4)));
  const [cap, setCap] = useState<number | null>(() =>
    Number(params.cap) > 0 ? Number(params.cap) : null
  );
  const [detailsOpen, setDetailsOpen] = useState(params.details === '1');
  // 19c "Try again with a new date" preseeds everything but the date
  const [location, setLocation] = useState(params.location ?? '');
  const [notes, setNotes] = useState('');
  // The one open question (PLA-47). Collapsed by default: most plans have no
  // question, and this flow must not grow for them.
  const [askOpen, setAskOpen] = useState(false);
  const [pollDraft, setPollDraft] = useState(emptyPollDraft());

  const { groups, hasGroups, loading: groupsLoading } = useMyGroups();

  // Opened from a group: that group is settled and the chip row collapses to it.
  const paramGroupId = params.groupId || null;
  const choices = paramGroupId ? groups.filter((g) => g.id === paramGroupId) : groups;
  const groupId = paramGroupId ?? pickedGroupId ?? choices[0]?.id ?? null;
  const group = choices.find((g) => g.id === groupId) ?? null;

  const toggleDay = (iso: string) =>
    setDates((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort()));

  // A half-typed question blocks the post rather than being silently
  // dropped: posting "Which film?" with one option is a poll nobody can
  // answer, and discarding typed text is worse.
  const pollBlocks = pollDraftTouched(pollDraft) && !pollDraftValid(pollDraft);
  const isValid = title.trim().length > 0 && dates.length > 0 && !!groupId && !pollBlocks;

  const createPlan = useCreatePlan();

  // `planazo://plan/create` opens this sheet with nothing behind it, and
  // back() is a no-op there: Cancel did nothing at all on a cold deep link.
  const cancel = useDismissTo('/(app)/(tabs)');

  // The form below cannot be completed without a group, so it is not offered:
  // that empty chip row and its permanently disabled "Post to …" were the dead
  // end PLA-68 was reported for. The "+" already sends this user to the
  // needs-group sheet, but this route is a live deep link nothing guards.
  const needsGroup = !groupsLoading && !hasGroups;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable
          onPress={cancel}
          accessibilityRole="button"
          testID="cancel"
          style={styles.headerAction}
        >
          <ThemedText variant="bodyStrong" color={colors.textMuted}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>New plan</ThemedText>
        <View style={styles.headerSpacer} />
      </View>

      {needsGroup ? (
        <NeedsGroupState
          body={NEEDS_GROUP_COPY.planBody}
          dismissFirst
          testID="create-needs-group"
        />
      ) : (
        <>
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
                        <View style={[styles.groupDot, { backgroundColor: g.color ?? colorForName(g.name) }]} />
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

              <WhenField dates={dates} onToggleDay={toggleDay} time={time} onTimeChange={setTime} />

              <HowManyField min={min} cap={cap} onMinChange={setMin} onCapChange={setCap} />

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

              {/* The one open question (PLA-47): same disclosure pattern as the
                  details, because most plans have no question and this flow must
                  not grow for them. */}
              <View style={styles.section}>
                <Pressable
                  onPress={() => setAskOpen((o) => !o)}
                  accessibilityRole="button"
                  testID="poll-toggle"
                  style={styles.detailsToggle}
                >
                  <ThemedText variant="bodyStrong" color={colors.accent}>
                    {askOpen ? 'Hide the question' : 'Add a question to vote on'}
                  </ThemedText>
                  <ThemedText variant="tag" color={colors.accent}>
                    ▾
                  </ThemedText>
                </Pressable>
                {askOpen ? (
                  <Animated.View entering={FadeInDown} exiting={FadeOutUp} style={styles.detailsFields}>
                    <PollComposer draft={pollDraft} onChange={setPollDraft} />
                  </Animated.View>
                ) : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>

          <FooterBar pinned>
            <Button
              // Naming the group is the point of this label, so it waits until
              // there is a name: "Post to …" used to flash for everyone while the
              // groups query resolved, and sat there forever for anyone with none
              // (PLA-68).
              label={
                createPlan.isPending ? 'Posting…' : group ? `Post to ${group.name}` : 'Post'
              }
              variant={isValid ? 'primary' : 'secondary'}
              disabled={!isValid || createPlan.isPending}
              haptic={isValid}
              onPress={() =>
                createPlan.mutate({
                  groupId,
                  title,
                  dates,
                  time,
                  min,
                  cap,
                  location,
                  notes,
                  pollDraft,
                })
              }
              testID="post-cta"
            />
          </FooterBar>
        </>
      )}
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
  },
  // The 14/10 that used to pad this row now lives on the button, which is what
  // makes the full bar height tappable rather than just the word (PLA-40).
  // "Cancel" is already wider than 44, so only the height needed fixing; the
  // row lands at 44 where it used to be 45.
  headerAction: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
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
  // 39 (9 + 18 + 9 + border) — picking the group is the first thing this
  // screen asks for. No row padding to reclaim, so the pill grows (PLA-40).
  groupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
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
  // Full width but only 20pt tall. The surplus goes back as margin, split
  // unevenly so it stays inside the 22pt gap above and the 10pt one below
  // rather than landing on the stepper card or the first input (PLA-40).
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    marginTop: -14,
    marginBottom: -10,
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
});
