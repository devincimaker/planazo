import { View, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ThemedText } from '../ui/ThemedText';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { colors, fonts, radii } from '../../theme/tokens';
import { usePendingInvites } from '../../lib/usePendingInvites';

// Minimal slice of react-navigation's BottomTabBarProps — typed locally so we
// don't import from a transitive package.
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: {
    navigate: (name: string) => void;
    emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => {
      defaultPrevented: boolean;
    };
  };
}

const LABELS: Record<string, string> = {
  index: 'Plans',
  groups: 'Groups',
};

function PlansIcon({ color }: { color: string }) {
  return (
    <View style={styles.gridIcon}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.gridCell, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

function GroupsIcon({ color }: { color: string }) {
  return (
    <View style={styles.circlesIcon}>
      <View style={[styles.circle, styles.circleLeft, { borderColor: color }]} />
      <View style={[styles.circle, styles.circleRight, { borderColor: color }]} />
    </View>
  );
}

/** Two tabs and one create action — the entire navigation surface (design 2a). */
export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { count: pendingCount } = usePendingInvites();

  // `undefined` is accepted so callers can index `state.routes` directly; a
  // missing route renders nothing rather than crashing the whole tab bar.
  const renderTab = (route: { key: string; name: string } | undefined, index: number) => {
    if (!route) return null;
    const focused = state.index === index;
    const color = focused ? colors.accent : colors.tabInactive;
    const label = LABELS[route.name] ?? route.name;

    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        navigation.navigate(route.name);
      }
    };

    return (
      <Pressable
        key={route.key}
        accessibilityRole="button"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={label}
        onPress={onPress}
        style={styles.tab}
        testID={`tab-${route.name}`}
      >
        <View style={styles.iconBox}>
          {route.name === 'index' ? <PlansIcon color={color} /> : <GroupsIcon color={color} />}
        </View>
        <ThemedText variant="tabLabel" color={focused ? colors.accent : colors.tabInactive}>
          {label}
        </ThemedText>
        {route.name === 'groups' && pendingCount > 0 ? (
          <View style={styles.badge} testID="groups-tab-badge">
            <ThemedText style={styles.badgeText} color={colors.textOnAccent}>
              {pendingCount}
            </ThemedText>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const onCreate = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    router.push('/(app)/plan/create');
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {renderTab(state.routes[0], 0)}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New plan"
        onPress={onCreate}
        style={styles.createWrap}
        testID="tab-create"
      >
        {({ pressed }) => (
          <View style={[styles.create, pressed && styles.createPressed]}>
            <ThemedText style={styles.plus} color={colors.textOnAccent}>
              +
            </ThemedText>
          </View>
        )}
      </Pressable>
      {renderTab(state.routes[1], 1)}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    backgroundColor: colors.tabBarBackground,
    borderTopWidth: 1,
    borderTopColor: colors.tabBarBorder,
    paddingHorizontal: 24,
    paddingTop: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    // 51 already (4 + 24 icon + 6 + 13 label + 4), and flex:1 makes it far
    // wider than 44. Pinned so shrinking the icon or label can't take the
    // whole tab under the minimum.
    minHeight: MIN_TOUCH_TARGET,
  },
  iconBox: {
    height: 24,
    justifyContent: 'center',
  },
  gridIcon: {
    width: 20,
    height: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  gridCell: {
    width: 8.5,
    height: 8.5,
    borderRadius: 2,
  },
  circlesIcon: {
    width: 24,
    height: 20,
  },
  circle: {
    position: 'absolute',
    top: 3,
    width: 14,
    height: 14,
    borderRadius: radii.pill,
    borderWidth: 2,
  },
  circleLeft: {
    left: 0,
  },
  circleRight: {
    right: 0,
  },
  createWrap: {
    flex: 1,
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  create: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createPressed: {
    backgroundColor: colors.accentPressed,
  },
  plus: {
    fontSize: 30,
    lineHeight: 34,
  },
  badge: {
    position: 'absolute',
    top: 0,
    left: '50%',
    marginLeft: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: fonts.bodyBold,
    fontSize: 11,
    lineHeight: 13,
  },
});
