import { describe, expect, it } from 'vitest';
import { invitationPathFromLink } from './invitation-link';

const token = 'A'.repeat(21) + '_b-' + 'c'.repeat(19);

describe('invitationPathFromLink', () => {
  it('accepts a full invitation URL', () => {
    expect(invitationPathFromLink(`https://example.test/invitations/${token}`)).toBe(
      `/invitations/${token}`,
    );
  });

  it('accepts a bare path and trims pasted whitespace', () => {
    expect(invitationPathFromLink(`  /invitations/${token}\n`)).toBe(`/invitations/${token}`);
  });

  it('drops query strings and fragments', () => {
    expect(invitationPathFromLink(`https://example.test/invitations/${token}?utm=chat#top`)).toBe(
      `/invitations/${token}`,
    );
  });

  it('rejects anything that is not the one deep-link shape', () => {
    expect(invitationPathFromLink('https://example.test/h/some-house')).toBeNull();
    expect(invitationPathFromLink(`https://example.test/invitations/${token}x`)).toBeNull();
    expect(invitationPathFromLink('/invitations/short')).toBeNull();
    expect(invitationPathFromLink('')).toBeNull();
  });
});
