import { useState } from 'react';
import { View, StyleSheet, Pressable, TextInput } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { filterByName, candidatesEmptyLine, memberName } from '../../lib/groupAdmins';
import { ThemedText, Card, Avatar } from '../ui';
import { colors, fonts, radii, spacing } from '../../theme/tokens';
import { settingsStyles } from './PrefSwitchRow';
import { adminRowStyles } from './AdminsCard';
import type { GroupMemberRow } from './MemberList';

/** The filled plus on a promote row. */
function PlusDot() {
  return (
    <View style={styles.plusDot}>
      <View style={styles.plusBarAcross} />
      <View style={styles.plusBarUp} />
    </View>
  );
}

/** The magnifier in the search box, same construction as Find people's. */
function SearchGlyph() {
  return (
    <View style={styles.searchIcon}>
      <View style={styles.searchCircle} />
      <View style={styles.searchHandle} />
    </View>
  );
}

interface Props {
  /** Every non-admin, already ordered; the search narrows from here. */
  candidates: GroupMemberRow[];
  disabled: boolean;
  onPromote: (m: GroupMemberRow) => void;
}

/**
 * "Make someone an admin": a search over the group's non-admins, each a
 * single tap from the role. No confirm on the way up — the demote control
 * sits one card above, so the tap undoes itself.
 */
export function PromoteCard({ candidates, disabled, onPromote }: Props) {
  const [query, setQuery] = useState('');
  const found = filterByName(candidates, query);

  return (
    <View style={settingsStyles.section}>
      <ThemedText variant="sectionLabel">Make someone an admin</ThemedText>

      <View style={styles.searchBox}>
        <SearchGlyph />
        <TextInput
          style={styles.searchInput}
          placeholder="Search members"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          testID="admin-search"
        />
      </View>

      <Card padded={false}>
        {found.map((m, index) => (
          <Pressable
            key={m.user_id}
            onPress={() => onPromote(m)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Make ${memberName(m)} an admin`}
            testID={`promote-${m.user_id}`}
            style={({ pressed }) => [
              adminRowStyles.personRow,
              index > 0 && settingsStyles.divider,
              pressed && adminRowStyles.rowPressed,
            ]}
          >
            <Avatar name={memberName(m)} size={36} imageUrl={m.profile?.avatar_url} />
            <ThemedText variant="bodyStrong" numberOfLines={1} style={styles.candidateName}>
              {m.profile?.display_name}
            </ThemedText>
            <View style={styles.plusBox}>
              <PlusDot />
            </View>
          </Pressable>
        ))}
        {found.length === 0 ? (
          <ThemedText variant="sub" style={styles.emptyLine} testID="candidates-empty">
            {candidatesEmptyLine(query)}
          </ThemedText>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  candidateName: {
    flex: 1,
    minWidth: 0,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radii.input,
    paddingHorizontal: 14,
  },
  searchIcon: {
    width: 15,
    height: 14,
  },
  searchCircle: {
    width: 13,
    height: 13,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    borderColor: colors.textFaint,
  },
  searchHandle: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 7,
    height: 1.5,
    backgroundColor: colors.textFaint,
    transform: [{ rotate: '45deg' }],
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 13,
  },
  plusBox: {
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
  },
  plusDot: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  plusBarAcross: {
    width: 9,
    height: 1.5,
    backgroundColor: colors.surface,
  },
  plusBarUp: {
    position: 'absolute',
    width: 1.5,
    height: 9,
    backgroundColor: colors.surface,
  },
  emptyLine: {
    paddingVertical: 26,
    paddingHorizontal: spacing.xl,
    textAlign: 'center',
  },
});
