import { inviteCodeFrom, inviteLinkFor } from '../inviteCode';

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

  it('still reads a code out of an old planazo:// link', () => {
    expect(inviteCodeFrom('planazo://join/ABCD2345')).toBe('ABCD2345');
  });
});
