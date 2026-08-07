import {
  canInvite,
  joinBlurb,
  joinLabel,
  joinModeOf,
  joinPendingLabel,
  linkBlurb,
  whoCanInviteOf,
} from '../groupDoor';

/**
 * The door's two dials, and the copy that has to keep pace with them (PLA-49).
 *
 * The narrowing functions matter more than they look: everything downstream
 * reads a `string` off the database, and a value nobody planned for has to
 * land on the permissive default rather than on some third behaviour. A group
 * whose door became unreadable should be an ordinary open group, not a locked
 * one.
 */
describe('whoCanInviteOf / joinModeOf', () => {
  it('narrows the two known values', () => {
    expect(whoCanInviteOf('admins')).toBe('admins');
    expect(whoCanInviteOf('members')).toBe('members');
    expect(joinModeOf('approval')).toBe('approval');
    expect(joinModeOf('open')).toBe('open');
  });

  it('falls back to fully open on anything else', () => {
    for (const value of [null, undefined, '', 'ADMINS', 'nonsense']) {
      expect(whoCanInviteOf(value)).toBe('members');
      expect(joinModeOf(value)).toBe('open');
    }
  });
});

describe('canInvite', () => {
  it('lets any member invite while the dial says members', () => {
    expect(canInvite('members', 'member')).toBe(true);
    expect(canInvite('members', 'admin')).toBe(true);
    expect(canInvite(null, null)).toBe(true);
  });

  it('leaves only admins holding a way in once the dial moves', () => {
    expect(canInvite('admins', 'member')).toBe(false);
    expect(canInvite('admins', null)).toBe(false);
    expect(canInvite('admins', 'admin')).toBe(true);
  });
});

describe('the copy', () => {
  it('promises what the link actually does', () => {
    expect(linkBlurb('open')).toBe('Anyone with the link joins straight away.');
    expect(linkBlurb('approval')).toBe(
      'People with the link ask to join, and an admin lets them in.'
    );
  });

  it('says whether the button joins or asks, before the tap and during it', () => {
    expect(joinLabel('open', 'Piso Gràcia')).toBe('Join Piso Gràcia');
    expect(joinLabel('approval', 'Piso Gràcia')).toBe('Ask to join Piso Gràcia');
    expect(joinPendingLabel('open')).toBe('Joining…');
    expect(joinPendingLabel('approval')).toBe('Asking…');
  });

  it('explains what pressing it means', () => {
    expect(joinBlurb('open')).toMatch(/see their plans/);
    expect(joinBlurb('approval')).toMatch(/An admin has to let you in/);
  });

  // The house rule: every one of these strings reaches a user.
  it('uses no em dash anywhere', () => {
    const all = [
      linkBlurb('open'),
      linkBlurb('approval'),
      joinLabel('open', 'X'),
      joinLabel('approval', 'X'),
      joinPendingLabel('open'),
      joinPendingLabel('approval'),
      joinBlurb('open'),
      joinBlurb('approval'),
    ];
    expect(all.some((s) => s.includes('—'))).toBe(false);
  });
});
