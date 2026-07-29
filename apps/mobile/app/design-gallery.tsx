import { useState } from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { Redirect, useLocalSearchParams } from 'expo-router';
import {
  ThemedText,
  Button,
  Card,
  Chip,
  Badge,
  Avatar,
  AvatarStack,
  SlotBar,
  DateOptionRow,
  AnswerFooter,
  ListRow,
  EmptyState,
  MonthCalendar,
} from '../components/ui';
import { colors, groupColors, spacing } from '../theme/tokens';

// Dev-only component gallery. Open with:
//   xcrun simctl openurl <UDID> "com.planazo.app://expo-development-client/?url=<metro>"
// then navigate to planazo://design-gallery

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">{title}</ThemedText>
      {children}
    </View>
  );
}

export default function DesignGallery() {
  // Screenshot-tooling affordances (simctl cannot scroll): ?tail=1 renders
  // sections bottom-up; ?y=<px> starts the scroll at an offset.
  const { tail, y } = useLocalSearchParams<{ tail?: string; y?: string }>();
  const [calDays, setCalDays] = useState<string[]>([]);

  if (!__DEV__) {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      style={styles.screen}
      contentOffset={y ? { x: 0, y: Number(y) } : undefined}
      contentContainerStyle={[styles.content, tail === '1' && styles.reversed]}
    >
      <ThemedText variant="screenTitle">Design gallery</ThemedText>
      <ThemedText variant="sub">Every component in the kit, all states.</ThemedText>

      <Section title="Type">
        <ThemedText variant="screenTitle">Padel + pizza</ThemedText>
        <ThemedText variant="cardTitle">Escape room revenge</ThemedText>
        <ThemedText variant="statusHeadline">1 more and it's on</ThemedText>
        <ThemedText variant="body">Thu 12 Feb · 19:30 at Padel Indoor Gràcia.</ThemedText>
        <ThemedText variant="sub">Bring wine, not opinions.</ThemedText>
        <ThemedText variant="caption">4 going · 2 pending</ThemedText>
      </Section>

      <Section title="Buttons">
        <Button label="I'm in" />
        <Button label="Can't make it" variant="secondary" />
        <Button label="Nudge the rest" variant="outline" />
        <Button label="Send 2 dates" size="md" />
        <Button label="Locked" disabled />
      </Section>

      <Section title="Chips + badges">
        <View style={styles.row}>
          <Chip label="All" active />
          <Chip label="Needs answer" />
          <Chip label="Happening" />
        </View>
        <View style={styles.row}>
          <Badge label="OPEN" tone="open" uppercase />
          <Badge label="CONFIRMED" tone="confirmed" uppercase />
          <Badge label="3 pending" tone="muted" />
        </View>
      </Section>

      <Section title="Faces">
        <View style={styles.row}>
          <Avatar name="Rocío" dark size={36} />
          {['Marta', 'Jordi', 'Aina', 'Lucas'].map((n, i) => (
            <Avatar key={n} name={n} bg={groupColors[i % groupColors.length]} size={36} />
          ))}
        </View>
        <AvatarStack
          names={['Marta', 'Jordi', 'Aina', 'Lucas', 'Pau', 'Clara', 'Toni']}
          label="6 going · 3 pending"
        />
      </Section>

      <Section title="Slot bar (floor + ceiling)">
        <Card>
          <ThemedText variant="statusHeadline">1 more and it's on</ThemedText>
          <View style={styles.gap} />
          <SlotBar going={2} min={3} cap={6} />
        </Card>
        <Card>
          <ThemedText variant="statusHeadline" color={colors.confirmed}>
            It's on
          </ThemedText>
          <View style={styles.gap} />
          <SlotBar going={4} min={3} cap={6} />
        </Card>
      </Section>

      <Section title="Month calendar">
        <MonthCalendar
          selected={calDays}
          onToggleDay={(iso) =>
            setCalDays((d) => (d.includes(iso) ? d.filter((x) => x !== iso) : [...d, iso].sort()))
          }
        />
      </Section>

      <Section title="Date options">
        <DateOptionRow label="Fri 13 Feb" meta="4 in" selected />
        <DateOptionRow label="Sat 14 Feb" meta="2 in" />
        <DateOptionRow label="Fri 20 Feb" meta="5 in" />
      </Section>

      <Section title="Answer footer">
        <AnswerFooter />
        <AnswerFooter answered="yes" />
        <AnswerFooter answered="yes" answerLabel="You sent 2 dates" />
        <AnswerFooter answered="no" />
      </Section>

      <Section title="Card with stripe + rows">
        <Card stripeColor={groupColors[0]} padded={false}>
          <ListRow title="Thursday 12 February" value="19:30" />
          <ListRow title="Padel Indoor Gràcia" value="Map" divider />
          <ListRow title="Hosted by Marta" divider onPress={() => {}} />
        </Card>
      </Section>

      <Section title="Empty state">
        <Card>
          <EmptyState
            title="Nothing to answer"
            body="When someone in a group proposes a plan, it lands here."
            ctaLabel="Start a plan"
          />
        </Card>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.xl,
    paddingTop: 72,
    paddingBottom: 64,
    gap: spacing.md,
  },
  reversed: {
    flexDirection: 'column-reverse',
  },
  section: {
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  gap: {
    height: spacing.md,
  },
});
