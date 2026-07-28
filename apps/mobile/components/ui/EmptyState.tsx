import { View, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { Button } from './Button';
import { spacing } from '../../theme/tokens';

interface EmptyStateProps {
  title: string;
  body?: string;
  ctaLabel?: string;
  onPress?: () => void;
  testID?: string;
}

/** Day-one states (16a/16c): say what this place is for, offer the one action. */
export function EmptyState({ title, body, ctaLabel, onPress, testID }: EmptyStateProps) {
  return (
    <View style={styles.container} testID={testID}>
      <ThemedText variant="cardTitle" style={styles.title}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText variant="sub" style={styles.body}>
          {body}
        </ThemedText>
      ) : null}
      {ctaLabel ? <Button label={ctaLabel} size="md" onPress={onPress} style={styles.cta} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xxl,
    gap: spacing.sm,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: 280,
  },
  cta: {
    marginTop: spacing.md,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
  },
});
