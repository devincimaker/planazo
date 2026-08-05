import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { ThemedText } from './ThemedText';
import { tileRadius } from './GroupTile';
import { pickFromLibrary, takePhoto } from '../../lib/images';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { colors, fonts, radii, spacing } from '../../theme/tokens';

const SHEET_TITLE = 'A photo makes the group easier to spot in a list.';
const TILE = 64;

interface GroupPhotoFieldProps {
  /** What to show: a local pick, the saved photo, or null for "no photo yet" */
  uri?: string | null;
  /** True while the photo is on its way to storage */
  uploading?: boolean;
  /** The line under Change / Remove — it says something different per screen */
  caption: string;
  onPick: (uri: string) => void;
  onRemove: () => void;
}

/**
 * PLA-30 "Photo" section, shared by the create sheet and Group profile. Three
 * states, one row: nothing yet, on its way, set. The letter tile is the
 * default, so the empty state is an invitation rather than a gap to fill.
 */
export function GroupPhotoField({
  uri,
  uploading = false,
  caption,
  onPick,
  onRemove,
}: GroupPhotoFieldProps) {
  // One list, so the labels and what they do cannot drift apart, and so the
  // indices the two platform branches dispatch on are derived rather than
  // written out twice. "Use the letter instead" only exists once there is a
  // photo to undo, which is exactly why nothing here may hardcode a position.
  const choices = [
    {
      label: 'Take a photo',
      run: async () => {
        const picked = await takePhoto();
        if (picked) onPick(picked);
      },
    },
    {
      label: 'Choose from library',
      run: async () => {
        const picked = await pickFromLibrary({ square: true });
        if (picked) onPick(picked);
      },
    },
    ...(uri ? [{ label: 'Use the letter instead', run: () => onRemove() }] : []),
  ];

  const openPhotoOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: SHEET_TITLE,
          options: [...choices.map((c) => c.label), 'Cancel'],
          cancelButtonIndex: choices.length,
          ...(uri ? { destructiveButtonIndex: choices.length - 1 } : {}),
        },
        // Cancel indexes past the end, so it resolves to undefined and no-ops.
        (index) => void choices[index]?.run()
      );
    } else {
      Alert.alert('Group photo', SHEET_TITLE, [
        ...choices.map((c) => ({ text: c.label, onPress: () => void c.run() })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  return (
    <View style={styles.section}>
      <ThemedText variant="sectionLabel">Photo</ThemedText>

      {uploading && uri ? (
        <View style={styles.row}>
          <Image source={{ uri }} style={[styles.tile, styles.tileSending]} />
          <View style={styles.sendingBody}>
            <ThemedText variant="caption" color={colors.textMuted}>
              Uploading…
            </ThemedText>
            <ProgressBar />
          </View>
        </View>
      ) : uri ? (
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change the group photo"
            onPress={openPhotoOptions}
          >
            <Image source={{ uri }} style={styles.tile} />
          </Pressable>
          <View style={styles.setBody}>
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                onPress={openPhotoOptions}
                style={styles.action}
                testID="change-photo"
              >
                <ThemedText style={styles.actionLabel} color={colors.accentText}>
                  Change
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={onRemove}
                style={styles.action}
                testID="remove-photo"
              >
                <ThemedText style={styles.actionLabel} color={colors.textMuted}>
                  Remove
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText variant="caption" color={colors.textMuted} style={styles.caption}>
              {caption}
            </ThemedText>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={openPhotoOptions}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          testID="add-photo"
        >
          <View style={[styles.tile, styles.tileEmpty]}>
            <ThemedText style={styles.plus} color={colors.textFaint}>
              +
            </ThemedText>
          </View>
          <View style={styles.emptyBody}>
            <ThemedText style={styles.actionLabel} color={colors.accentText}>
              Add a photo
            </ThemedText>
            <ThemedText variant="caption" color={colors.textMuted} style={styles.caption}>
              Optional. Without one the group keeps its letter.
            </ThemedText>
          </View>
        </Pressable>
      )}
    </View>
  );
}

/**
 * Indeterminate on purpose. supabase-js `upload` resolves or throws with
 * nothing in between, so a percentage would be a number we made up. This says
 * "working" honestly and stops when the upload does.
 */
function ProgressBar() {
  const travel = useRef(new Animated.Value(0)).current;
  const [track, setTrack] = useState(0);

  // Started once, not per layout pass: the interpolation below is rebuilt on
  // every render anyway, so it picks up the measured width without the loop
  // having to stop and restart.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(travel, {
        toValue: 1,
        duration: 1100,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [travel]);

  const segment = Math.max(24, track * 0.4);

  return (
    <View style={styles.progressTrack} onLayout={(e) => setTrack(e.nativeEvent.layout.width)}>
      <Animated.View
        style={[
          styles.progressFill,
          {
            width: segment,
            transform: [
              {
                translateX: travel.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-segment, track],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: MIN_TOUCH_TARGET,
  },
  rowPressed: {
    opacity: 0.7,
  },
  // Same squircle as the real tile, by reference rather than by a 20 that
  // happens to match today.
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: tileRadius(TILE),
    overflow: 'hidden',
  },
  tileEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderStyle: 'dashed',
  },
  tileSending: {
    opacity: 0.5,
  },
  plus: {
    fontFamily: fonts.bodyBold,
    fontSize: 26,
    lineHeight: undefined,
  },
  emptyBody: {
    gap: spacing.xxs,
  },
  setBody: {
    gap: spacing.xs,
  },
  sendingBody: {
    flex: 1,
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  // The words are 20 tall; the box takes 44 and gives the surplus back, so the
  // row does not grow and the two targets still do not overlap (PLA-40).
  action: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    marginVertical: -12,
  },
  actionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    lineHeight: 20,
  },
  caption: {
    lineHeight: 19,
    maxWidth: 200,
  },
  progressTrack: {
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
