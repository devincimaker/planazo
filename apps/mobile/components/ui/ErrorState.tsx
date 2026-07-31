import { View, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { Button } from './Button';
import { spacing } from '../../theme/tokens';

interface ErrorStateProps {
  title: string;
  body?: string;
  /** Primary recovery. Omit for states a retry can't fix (a deleted plan). */
  onRetry?: () => void;
  retryLabel?: string;
  /** Secondary way out — always offer one when the screen has no other chrome. */
  onBack?: () => void;
  backLabel?: string;
  testID?: string;
}

/**
 * The other half of EmptyState: what a screen shows when the fetch failed.
 * Every `isLoading ? spinner` guard needs one of these, or a query that
 * settles with no data spins forever (PLA-15/PLA-19).
 */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = 'Try again',
  onBack,
  backLabel = 'Go back',
  testID,
}: ErrorStateProps) {
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
      {onRetry ? (
        <Button
          label={retryLabel}
          size="md"
          onPress={onRetry}
          style={styles.cta}
          testID={testID ? `${testID}-retry` : undefined}
        />
      ) : null}
      {onBack ? (
        <Button
          label={backLabel}
          variant="secondary"
          size="md"
          onPress={onBack}
          style={onRetry ? styles.secondaryCta : styles.cta}
          testID={testID ? `${testID}-back` : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
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
  secondaryCta: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
  },
});
