import { roleActionFor, roleActionLabel } from '../memberRole';

describe('roleActionFor', () => {
  it('offers nothing to a non-admin viewer, whatever the target', () => {
    expect(
      roleActionFor({ viewerIsAdmin: false, targetRole: 'member', adminCount: 1 })
    ).toBeNull();
    expect(
      roleActionFor({ viewerIsAdmin: false, targetRole: 'admin', adminCount: 2 })
    ).toBeNull();
    expect(roleActionFor({ viewerIsAdmin: false, targetRole: null, adminCount: 0 })).toBeNull();
  });

  it('offers promote on a member', () => {
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: 'member', adminCount: 1 })).toBe(
      'promote'
    );
  });

  // A row with no role is not an admin, and promoting is the only thing that
  // could make sense of it.
  it('offers promote on a null role', () => {
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: null, adminCount: 1 })).toBe(
      'promote'
    );
  });

  it('offers demote on an admin while another admin exists', () => {
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: 'admin', adminCount: 2 })).toBe(
      'demote'
    );
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: 'admin', adminCount: 5 })).toBe(
      'demote'
    );
  });

  it('blocks demoting the last admin', () => {
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: 'admin', adminCount: 1 })).toBe(
      'demote-blocked'
    );
  });

  // Data that claims an admin exists while counting none is inconsistent;
  // offering the demotion that would make it true is the one wrong answer.
  it('blocks demotion when the admin count says zero', () => {
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: 'admin', adminCount: 0 })).toBe(
      'demote-blocked'
    );
  });

  it('still offers promote when the admin count says zero', () => {
    expect(roleActionFor({ viewerIsAdmin: true, targetRole: 'member', adminCount: 0 })).toBe(
      'promote'
    );
  });
});

describe('roleActionLabel', () => {
  it('promote reads the same for anyone', () => {
    expect(roleActionLabel('promote', false)).toBe('Make admin');
    expect(roleActionLabel('promote', true)).toBe('Make admin');
  });

  it('demoting another admin is removing them', () => {
    expect(roleActionLabel('demote', false)).toBe('Remove as admin');
  });

  it('demoting yourself is stepping down', () => {
    expect(roleActionLabel('demote', true)).toBe('Step down as admin');
  });
});
