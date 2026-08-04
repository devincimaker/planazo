import { View, StyleSheet, Pressable } from 'react-native';
import { useFriends } from '../../lib/useFriends';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { ThemedText, Card, Avatar } from '../ui';
import { colors, radii, spacing } from '../../theme/tokens';

interface Props {
  /** Ids of the friends currently picked, owned by the screen. */
  picks: string[];
  onToggle: (id: string) => void;
}

/**
 * "Who's in": the friends list with a check on each pick, and a row of chips
 * above it for the ones already chosen.
 *
 * Owns the friend query (17c "Your people": accepted friendships, either
 * direction) because nothing outside this section reads it. The picks
 * themselves stay with the screen, which is what invites them once the group
 * exists.
 */
export function FriendPicker({ picks, onToggle }: Props) {
  const { friends } = useFriends();
  const selected = (friends ?? []).filter((f) => picks.includes(f.id));

  return (
    <View style={styles.section}>
      <View style={styles.pickerHeader}>
        <ThemedText variant="sectionLabel">Who's in</ThemedText>
        {picks.length > 0 ? (
          <ThemedText variant="caption" color={colors.textPrimary}>
            {picks.length} selected
          </ThemedText>
        ) : null}
      </View>

      {selected.length > 0 ? (
        <View style={styles.chipWrap}>
          {selected.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              onPress={() => onToggle(f.id)}
              style={styles.selectedChip}
              testID={`chip-${f.id}`}
            >
              <Avatar name={f.name} size={22} imageUrl={f.avatarUrl} />
              <ThemedText variant="caption" color={colors.background}>
                {f.name.split(' ')[0]}
              </ThemedText>
              <ThemedText variant="caption" color={colors.textMuted}>
                ×
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {(friends ?? []).length === 0 ? (
        <ThemedText variant="sub">
          Friends you add on Planazo show up here. You can also invite people once the group
          exists.
        </ThemedText>
      ) : (
        <Card padded={false}>
          {(friends ?? []).map((f, i) => {
            const picked = picks.includes(f.id);
            return (
              <Pressable
                key={f.id}
                accessibilityRole="button"
                accessibilityState={{ selected: picked }}
                onPress={() => onToggle(f.id)}
                style={({ pressed }) => [
                  styles.personRow,
                  i > 0 && styles.personDivider,
                  pressed && styles.personPressed,
                ]}
                testID={`person-${f.id}`}
              >
                <Avatar name={f.name} size={40} imageUrl={f.avatarUrl} />
                <View style={styles.personBody}>
                  <ThemedText variant="bodyStrong" numberOfLines={1}>
                    {f.name}
                  </ThemedText>
                  {f.handle ? <ThemedText variant="caption">@{f.handle}</ThemedText> : null}
                </View>
                <View style={[styles.check, picked && styles.checkOn]}>
                  {picked ? (
                    <ThemedText variant="tag" color={colors.textOnAccent}>
                      ✓
                    </ThemedText>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  // 34 (6 + 22 avatar + 6) with a "×" on it — removing someone you added by
  // mistake should not need aim (PLA-40).
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    gap: 7,
    backgroundColor: colors.ink,
    borderRadius: radii.pill,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 11,
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  personDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  personPressed: {
    backgroundColor: colors.surfaceSunken,
  },
  personBody: {
    flex: 1,
    gap: 1,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
});
