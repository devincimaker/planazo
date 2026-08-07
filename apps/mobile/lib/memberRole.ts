import type { GroupRole } from '@planazo/shared';

/**
 * What the Admins screen may do to one member's role (PLA-50).
 *
 * `promote` and `demote` are the two real actions. `demote-blocked` is the
 * last-admin rule: a group with no admin is unmanageable, so the only admin
 * cannot step down — the screen shows explanatory copy in place of the
 * action, never a disabled control. `null` means no action at all, which is
 * how the screen degrades to a read-only list for a non-admin who deep-links
 * in (RLS blocks the write regardless; this keeps the UI honest about it).
 */
export type RoleAction = 'promote' | 'demote' | 'demote-blocked';

export function roleActionFor({
  viewerIsAdmin,
  targetRole,
  adminCount,
}: {
  viewerIsAdmin: boolean;
  targetRole: GroupRole | null;
  adminCount: number;
}): RoleAction | null {
  if (!viewerIsAdmin) return null;
  if (targetRole !== 'admin') return 'promote';
  // Covers the impossible-but-defensive adminCount of 0 too: data that
  // claims an admin exists while counting none still must not offer the
  // demotion that would make it true.
  return adminCount <= 1 ? 'demote-blocked' : 'demote';
}

/**
 * The button label for an actionable flip. Demoting yourself is "stepping
 * down": same write, but the sentence belongs to the person doing it.
 * `demote-blocked` never reaches here — it renders as copy, not a button.
 */
export function roleActionLabel(action: 'promote' | 'demote', isSelf: boolean): string {
  if (action === 'promote') return 'Make admin';
  return isSelf ? 'Step down as admin' : 'Remove as admin';
}
