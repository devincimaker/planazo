/**
 * Everything the Admins screen derives without touching the network
 * ("Group Admins" design doc, PLA-50). The screen splits the group into the
 * admins card and the "Make someone an admin" list; these are the seams.
 */

/** The slice of a membership row this module reads. */
export interface AdminsMember {
  user_id: string;
  role: 'admin' | 'member' | null;
  joined_at: string | null;
  profile: { display_name: string | null; avatar_url: string | null } | null;
}

/**
 * The two cards: current admins, then everyone who could become one. Both
 * keep the People card's order (you first, then by arrival), so a name sits
 * where the previous screen taught you to look for it.
 */
export function splitByRole<T extends AdminsMember>(
  members: T[],
  myId: string | undefined
): { admins: T[]; candidates: T[] } {
  const meFirst = (rows: T[]) => {
    const byArrival = [...rows].sort((a, b) =>
      (a.joined_at ?? '').localeCompare(b.joined_at ?? '')
    );
    const mine = byArrival.filter((m) => m.user_id === myId);
    return [...mine, ...byArrival.filter((m) => m.user_id !== myId)];
  };
  return {
    admins: meFirst(members.filter((m) => m.role === 'admin')),
    candidates: meFirst(members.filter((m) => m.role !== 'admin')),
  };
}

/** Case-insensitive name match for the "Make someone an admin" search. */
export function filterByName<T extends AdminsMember>(members: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;
  return members.filter((m) => (m.profile?.display_name ?? '').toLowerCase().includes(q));
}

/** The line under an admin's name. Promotions carry no timestamp, so the one date we do know is the only one shown. */
export function adminSub(userId: string, createdBy: string | null): string {
  return userId === createdBy ? 'Made the group' : 'Admin';
}

/** The admins card's section label. */
export function adminsLabel(adminCount: number): string {
  return `Admins · ${adminCount}`;
}

/** The subtitle on Manage's Admins row. Only admins see the row, so "you" is safe. */
export function adminSummary(adminCount: number): string {
  return adminCount === 1 ? 'Just you' : `${adminCount} people run this group`;
}

/** The caption under the admins card. */
export function adminsNote(isLastAdmin: boolean): string {
  return isLastAdmin
    ? 'A group needs at least one admin. Make someone else one first.'
    : 'They keep their place in the group either way.';
}

/** What the empty candidates card says, echoing the search that emptied it. */
export function candidatesEmptyLine(query: string): string {
  const q = query.trim();
  return q ? `Nobody called “${q}” in this group.` : 'Everyone here is already an admin.';
}

/** The demotion sheet's copy. Stepping down and removing are the same write with different weight. */
export function demoteConfirmCopy(
  name: string,
  isSelf: boolean
): { title: string; body: string; actionLabel: string } {
  if (isSelf) {
    return {
      title: 'Step down as admin?',
      body: 'You stay in the group. Someone else keeps admin, and any admin can hand it back to you.',
      actionLabel: 'Step down',
    };
  }
  return {
    title: `Remove ${name} as admin?`,
    body: `${name} stays in the group. They just stop being able to edit it or remove people. You can make them an admin again any time.`,
    actionLabel: 'Remove',
  };
}
