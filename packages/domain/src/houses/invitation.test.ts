import { describe, expect, it } from 'vitest';
import { invitationCreationPolicy } from './invitation';

describe('Invitation creation policy', () => {
  it('[BM-014] [DR-INVITE-04] gives a shared Invitation seven days and the remaining House capacity', () => {
    const createdAt = new Date('2026-08-30T10:00:00.000Z');

    expect(
      invitationCreationPolicy(
        { kind: 'shared' },
        { activeMemberCount: 7, memberCap: 30, createdAt },
      ),
    ).toEqual({
      kind: 'shared',
      intendedEmail: null,
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 23,
    });
  });

  it('[BM-014] [DR-INVITE-05] makes an email-restricted Invitation single-use', () => {
    expect(
      invitationCreationPolicy(
        { kind: 'single', intendedEmail: '  Friend@Example.Test ' },
        {
          activeMemberCount: 29,
          memberCap: 30,
          createdAt: new Date('2026-08-30T10:00:00.000Z'),
        },
      ),
    ).toEqual({
      kind: 'single',
      intendedEmail: 'friend@example.test',
      expiresAt: new Date('2026-09-06T10:00:00.000Z'),
      useLimit: 1,
    });
  });

  it('[BM-014] [DR-INVITE-04] refuses a shared Invitation when no capacity remains', () => {
    expect(() =>
      invitationCreationPolicy(
        { kind: 'shared' },
        {
          activeMemberCount: 30,
          memberCap: 30,
          createdAt: new Date('2026-08-30T10:00:00.000Z'),
        },
      ),
    ).toThrow(expect.objectContaining({ code: 'conflict' }));
  });
});
