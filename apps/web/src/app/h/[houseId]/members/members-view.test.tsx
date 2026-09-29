import type { HouseHome, HouseRoster, PendingInvitation } from '@between-moves/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MembersView } from './members-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const houseId = '01941f29-7c00-7000-8000-000000000201';
const home: HouseHome = {
  houseId,
  name: 'The Thursday Table',
  description: null,
  emblemSeed: `house:${houseId}`,
  timeZone: 'Europe/Lisbon',
  membershipRole: 'owner',
};
const joinedAt = new Date('2026-09-01T10:00:00.000Z');
const owner = { membershipId: 'm-owner', displayName: 'Maya', role: 'owner', joinedAt } as const;
const steward = {
  membershipId: 'm-steward',
  displayName: 'Theo',
  role: 'steward',
  joinedAt,
} as const;
const member = {
  membershipId: 'm-member',
  displayName: 'Priya',
  role: 'member',
  joinedAt,
} as const;
const invitation: PendingInvitation = {
  invitationId: 'i-1',
  kind: 'single',
  intendedEmail: 'kenji@example.test',
  createdAt: joinedAt,
  expiresAt: new Date('2026-09-08T10:00:00.000Z'),
  useLimit: 1,
  useCount: 0,
  creatorName: 'Maya',
};

function render(
  viewer: 'm-owner' | 'm-steward' | 'm-member',
  invitations: PendingInvitation[] = [],
) {
  const roster: HouseRoster = {
    houseId,
    memberCap: 8,
    viewerMembershipId: viewer,
    viewerRole: viewer === 'm-owner' ? 'owner' : viewer === 'm-steward' ? 'steward' : 'member',
    members: [owner, steward, member],
  };
  return renderToStaticMarkup(
    <MembersView
      home={home}
      roster={roster}
      invitations={invitations}
      viewedAt={new Date('2026-09-02T10:00:00.000Z')}
    />,
  );
}

function manageCount(html: string): number {
  return html.match(/<summary>Manage/g)?.length ?? 0;
}

describe('Members page', () => {
  it('[BM-015] lets the Owner manage everyone but themselves', () => {
    const html = render('m-owner', [invitation]);

    expect(html).toContain('3 of 8 seats taken.');
    expect(manageCount(html)).toBe(2);
    expect(html).toContain('Make Member');
    expect(html).toContain('Make Steward');
    expect(html).toContain('Hand over the House');
    expect(html).toContain('Invite someone');
    expect(html).toContain('For kenji@example.test');
    expect(html).toContain('0 of 1 use');
    expect(html).toContain('Expires in 6 days');
    expect(html).toContain('You own this House.');
  });

  it('[BM-015] lets a Steward remove only Members and invite', () => {
    const html = render('m-steward');

    expect(manageCount(html)).toBe(1);
    expect(html).not.toContain('Hand over the House');
    expect(html).not.toContain('Make Steward');
    expect(html).toContain('Remove from House');
    expect(html).toContain('Invite someone');
    expect(html).toContain('No invitations are waiting.');
    expect(html).toContain('Leave this House');
  });

  it('[BM-014] shows a Member no controls and no invitations', () => {
    const html = render('m-member', [invitation]);

    expect(manageCount(html)).toBe(0);
    expect(html).not.toContain('Invite someone');
    expect(html).not.toContain('kenji@example.test');
    expect(html).toContain('Ask Maya or a Steward for an invitation link.');
    expect(html).toContain('>You<');
  });
});
