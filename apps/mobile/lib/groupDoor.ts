import type { GroupRole } from '@planazo/shared';

/**
 * The two dials on a group's door (PLA-49), and the handful of decisions that
 * read off them.
 *
 * Both default to fully open, so a group of five never meets any of this. The
 * settings exist for the fifty-person community, which is a different thing
 * wearing the same shape.
 *
 * The copy lives here rather than in the screens because the same distinction
 * has to be told honestly in three places — the invite sheet, the join screen,
 * and the manage toggles — and a button that says "Join" for a door that will
 * only file a request is the shape of the whole issue in miniature.
 */

/** Who may hand out a way into the group. */
export type WhoCanInvite = 'members' | 'admins';

/** What the bearer link does when somebody opens it. */
export type JoinMode = 'open' | 'approval';

export function whoCanInviteOf(value: string | null | undefined): WhoCanInvite {
  return value === 'admins' ? 'admins' : 'members';
}

export function joinModeOf(value: string | null | undefined): JoinMode {
  return value === 'approval' ? 'approval' : 'open';
}

/**
 * Whether to offer this person the invite sheet at all.
 *
 * The admins dial shuts both credential forms at once, so a member who cannot
 * send a named invite cannot read the link either. Hiding the entry point is
 * the courtesy; `invite_to_group` and `get_group_invite_code` are the rule.
 */
export function canInvite(
  whoCanInvite: string | null | undefined,
  role: GroupRole | null | undefined,
): boolean {
  return whoCanInviteOf(whoCanInvite) === 'members' || role === 'admin';
}

/** What the invite sheet promises about the link it is showing. */
export function linkBlurb(joinMode: string | null | undefined): string {
  return joinModeOf(joinMode) === 'approval'
    ? 'People with the link ask to join, and an admin lets them in.'
    : 'Anyone with the link joins straight away.';
}

/** The join screen's button, before the tap rather than after it. */
export function joinLabel(joinMode: string | null | undefined, groupName: string): string {
  return joinModeOf(joinMode) === 'approval' ? `Ask to join ${groupName}` : `Join ${groupName}`;
}

/** The same button mid-tap. */
export function joinPendingLabel(joinMode: string | null | undefined): string {
  return joinModeOf(joinMode) === 'approval' ? 'Asking…' : 'Joining…';
}

/** And what pressing it is going to mean. */
export function joinBlurb(joinMode: string | null | undefined): string {
  return joinModeOf(joinMode) === 'approval'
    ? 'An admin has to let you in. They get your request the moment you send it.'
    : 'Join and you’ll see their plans, and they’ll see yours.';
}
