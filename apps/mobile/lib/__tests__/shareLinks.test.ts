import { inviteCodeFrom } from '../inviteCode';
import { inviteLinkFor, planLinkFor } from '../shareLinks';

describe('inviteLinkFor', () => {
  it('builds an https link on the associated domain', () => {
    expect(inviteLinkFor('ABCD2345')).toBe('https://planazo.me/join/ABCD2345');
  });

  /**
   * The two halves of PLA-77 have to agree: the link we hand out is the one
   * the paste field can still read, for anyone whose universal link does not
   * fire (an Android phone, a desktop, a messenger that mangles the URL).
   */
  it('round-trips through the paste field', () => {
    expect(inviteCodeFrom(inviteLinkFor('K4M7P2QR'))).toBe('K4M7P2QR');
  });
});

describe('planLinkFor', () => {
  it('builds an https link on the associated domain', () => {
    expect(planLinkFor('c0ffee00-1111-2222-3333-444444444444')).toBe(
      'https://planazo.me/plan/c0ffee00-1111-2222-3333-444444444444'
    );
  });

  /**
   * PLA-81: the defect this whole change exists for. A `planazo://` link is not
   * something a messenger will linkify, so it arrives as grey text.
   */
  it('never hands out the custom scheme', () => {
    expect(planLinkFor('abc123')).not.toContain('planazo://');
  });
});
