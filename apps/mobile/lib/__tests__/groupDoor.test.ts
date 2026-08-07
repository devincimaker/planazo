import {
  canInvite,
  joinBlurb,
  joinLabel,
  joinModeOf,
  joinPendingLabel,
  linkBlurb,
  linkUnavailable,
  requestedBlurb,
  requestedEyebrow,
  requestedTitle,
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

  // The deep-link screen shows the eyebrow above the group's name; the paste-a-
  // code alert has only a title and has to carry both. Same sentence either way,
  // which is what the shared constant is for.
  it('says the ask is filed the same way on both surfaces', () => {
    expect(requestedTitle('Piso Gràcia')).toBe(`${requestedEyebrow} Piso Gràcia`);
    expect(requestedTitle('Piso Gràcia')).toBe('You’ve asked to join Piso Gràcia');
  });

  // Deliberately a constant answer and not a function of anything: a decline is
  // never announced (PLA-44), so a turned-down requester who taps the same link
  // reads exactly what a first-time asker reads.
  it('tells a requester nothing about which kind of ask this is', () => {
    expect(requestedBlurb()).toBe('An admin has your request. You’ll hear the moment they let you in.');
  });
});

describe('linkUnavailable', () => {
  it('names the door when the door is the reason', () => {
    expect(linkUnavailable('admins', 'member')).toBe('Only admins can hand out a link to this group.');
    expect(linkUnavailable('admins', null)).toMatch(/Only admins/);
  });

  it('blames the network when the person is allowed a link', () => {
    for (const [dial, role] of [
      ['admins', 'admin'],
      ['members', 'member'],
      [null, null],
    ] as const) {
      expect(linkUnavailable(dial, role)).toMatch(/Check your connection/);
    }
  });

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
    requestedEyebrow,
    requestedTitle('X'),
    requestedBlurb(),
    linkUnavailable('admins', 'member'),
    linkUnavailable('members', 'member'),
  ];
  expect(all.some((s) => s.includes('—'))).toBe(false);
});
