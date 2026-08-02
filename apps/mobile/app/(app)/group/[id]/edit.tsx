import { useState } from 'react';
import { View, StyleSheet, Pressable, TextInput, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../../../lib/supabase';
import { contentViolation } from '../../../../lib/moderation';
import { ThemedText, GroupTile } from '../../../../components/ui';
import { colors, fonts, groupColors, spacing } from '../../../../theme/tokens';

/** 6e "Rename or recolour" — same language as the create sheet, nothing else. */
export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);

  const { data: group } = useQuery({
    queryKey: ['group-edit', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('id, name, color')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const draftName = name ?? group?.name ?? '';
  const draftColor = color ?? group?.color ?? groupColors[0];
  const dirty =
    !!group && (draftName.trim() !== group.name || draftColor !== (group.color ?? groupColors[0]));
  const valid = draftName.trim().length > 0;

  const save = useMutation({
    mutationFn: async () => {
      // Guideline 1.2: objectionable language stops here, not in review.
      const violation = contentViolation({ 'group name': draftName });
      if (violation) throw new Error(violation);
      const { error } = await supabase
        .from('groups')
        .update({ name: draftName.trim(), color: draftColor })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group', id] });
      queryClient.invalidateQueries({ queryKey: ['group-manage', id] });
      queryClient.invalidateQueries({ queryKey: ['group-edit', id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      queryClient.invalidateQueries({ queryKey: ['home-plans'] });
      router.back();
    },
    onError: (error: Error) => Alert.alert('Error', error.message),
  });

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" testID="cancel">
          <ThemedText variant="bodyStrong" color={colors.textMuted}>
            Cancel
          </ThemedText>
        </Pressable>
        <ThemedText style={styles.headerTitle}>Rename or recolour</ThemedText>
        <Pressable
          onPress={() => save.mutate()}
          disabled={!dirty || !valid || save.isPending}
          accessibilityRole="button"
          testID="save"
        >
          <ThemedText
            variant="bodyStrong"
            color={dirty && valid ? colors.accent : colors.textFaint}
          >
            Save
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={styles.nameRow}>
          <GroupTile name={valid ? draftName : '?'} color={draftColor} size={52} />
          <View style={styles.nameBlock}>
            <TextInput
              style={styles.nameInput}
              placeholder="Name the group"
              placeholderTextColor={colors.textFaint}
              value={draftName}
              onChangeText={setName}
              testID="name-input"
            />
            <View style={styles.rule} />
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText variant="sectionLabel">Colour</ThemedText>
          <View style={styles.swatches}>
            {groupColors.map((swatch) => (
              <Pressable
                key={swatch}
                accessibilityRole="button"
                accessibilityState={{ selected: swatch === draftColor }}
                onPress={() => setColor(swatch)}
                style={[
                  styles.swatch,
                  { backgroundColor: swatch },
                  swatch === draftColor && styles.swatchSelected,
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 14,
    paddingBottom: 10,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 17,
    lineHeight: 21,
    color: colors.textPrimary,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    gap: spacing.xxl,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  nameBlock: {
    flex: 1,
    gap: spacing.sm,
  },
  nameInput: {
    fontFamily: fonts.displayHeavy,
    fontSize: 26,
    letterSpacing: -0.52,
    color: colors.textPrimary,
    padding: 0,
  },
  rule: {
    height: 2,
    backgroundColor: colors.borderStrong,
  },
  section: {
    gap: 10,
  },
  swatches: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  swatch: {
    width: 46,
    height: 46,
    borderRadius: 15,
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  swatchSelected: {
    borderColor: colors.ink,
  },
});
