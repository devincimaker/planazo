import {
  splitByRole,
  filterByName,
  adminSub,
  adminsLabel,
  adminSummary,
  adminsNote,
  candidatesEmptyLine,
  demoteConfirmCopy,
  type AdminsMember,
} from '../groupAdmins';

function member(
  user_id: string,
  role: 'admin' | 'member' | null,
  joined_at: string | null,
  name: string | null = user_id
): AdminsMember {
  return { user_id, role, joined_at, profile: { display_name: name, avatar_url: null } };
}

describe('splitByRole', () => {
  const rows = [
    member('c', 'member', '2026-03-01'),
    member('a', 'admin', '2026-01-01'),
    member('me', 'admin', '2026-02-01'),
    member('b', 'member', '2026-04-01'),
  ];

  it('splits admins from the rest, each side sorted by arrival with me first', () => {
    const { admins, candidates } = splitByRole(rows, 'me');
    expect(admins.map((m) => m.user_id)).toEqual(['me', 'a']);
    expect(candidates.map((m) => m.user_id)).toEqual(['c', 'b']);
  });

  it('a null role is a candidate, never an admin', () => {
    const { admins, candidates } = splitByRole([member('x', null, '2026-01-01')], 'me');
    expect(admins).toEqual([]);
    expect(candidates.map((m) => m.user_id)).toEqual(['x']);
  });

  it('me-first applies to whichever side I am on', () => {
    const { candidates } = splitByRole(
      [member('z', 'member', '2026-01-01'), member('me', 'member', '2026-06-01')],
      'me'
    );
    expect(candidates.map((m) => m.user_id)).toEqual(['me', 'z']);
  });

  it('no viewer id and null joined_at still order deterministically', () => {
    const { candidates } = splitByRole(
      [member('b', 'member', '2026-01-01'), member('a', 'member', null)],
      undefined
    );
    expect(candidates.map((m) => m.user_id)).toEqual(['a', 'b']);
  });

  it('an empty group splits into two empty lists', () => {
    expect(splitByRole([], 'me')).toEqual({ admins: [], candidates: [] });
  });
});

describe('filterByName', () => {
  const rows = [
    member('u1', 'member', null, 'Diego Morales'),
    member('u2', 'member', null, 'Maya Patel'),
    member('u3', 'member', null, null),
  ];

  it('matches case-insensitively anywhere in the name', () => {
    expect(filterByName(rows, 'morA').map((m) => m.user_id)).toEqual(['u1']);
  });

  it('an empty or whitespace query keeps everyone', () => {
    expect(filterByName(rows, '')).toEqual(rows);
    expect(filterByName(rows, '   ')).toEqual(rows);
  });

  it('trims the query before matching', () => {
    expect(filterByName(rows, '  maya ').map((m) => m.user_id)).toEqual(['u2']);
  });

  it('a missing display name never matches a query', () => {
    expect(filterByName(rows, 'x')).toEqual([]);
  });
});

describe('adminSub', () => {
  it('credits the group creator', () => {
    expect(adminSub('u1', 'u1')).toBe('Made the group');
  });

  it('everyone else is plainly Admin, including when created_by is unknown', () => {
    expect(adminSub('u1', 'u2')).toBe('Admin');
    expect(adminSub('u1', null)).toBe('Admin');
  });
});

describe('labels and notes', () => {
  it('adminsLabel counts', () => {
    expect(adminsLabel(1)).toBe('Admins · 1');
    expect(adminsLabel(4)).toBe('Admins · 4');
  });

  it('adminSummary addresses the sole admin directly', () => {
    expect(adminSummary(1)).toBe('Just you');
    expect(adminSummary(3)).toBe('3 people run this group');
  });

  it('adminsNote explains the floor only when standing on it', () => {
    expect(adminsNote(true)).toBe('A group needs at least one admin. Make someone else one first.');
    expect(adminsNote(false)).toBe('They keep their place in the group either way.');
  });

  it('candidatesEmptyLine echoes a trimmed query, or explains the empty card', () => {
    expect(candidatesEmptyLine('  Zoe ')).toBe('Nobody called “Zoe” in this group.');
    expect(candidatesEmptyLine('')).toBe('Everyone here is already an admin.');
    expect(candidatesEmptyLine('   ')).toBe('Everyone here is already an admin.');
  });
});

describe('demoteConfirmCopy', () => {
  it('stepping down speaks to you and promises a way back', () => {
    expect(demoteConfirmCopy('Demo', true)).toEqual({
      title: 'Step down as admin?',
      body: 'You stay in the group. Someone else keeps admin, and any admin can hand it back to you.',
      actionLabel: 'Step down',
    });
  });

  it('removing someone names them and softens the loss', () => {
    expect(demoteConfirmCopy('Jordi', false)).toEqual({
      title: 'Remove Jordi as admin?',
      body: 'Jordi stays in the group. They just stop being able to edit it or remove people. You can make them an admin again any time.',
      actionLabel: 'Remove',
    });
  });
});
