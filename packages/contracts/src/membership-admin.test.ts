import { describe, expect, it } from 'vitest';
import { membershipRoleChangeBodySchema, ownershipTransferBodySchema } from './membership-admin';

describe('BM-015 membership administration contracts', () => {
  it('accepts only permanent role changes', () => {
    expect(membershipRoleChangeBodySchema.safeParse({ role: 'steward' }).success).toBe(true);
    expect(membershipRoleChangeBodySchema.safeParse({ role: 'owner' }).success).toBe(false);
  });

  it('requires a UUID ownership-transfer target', () => {
    expect(
      ownershipTransferBodySchema.safeParse({
        toMembershipId: '01941f29-7c00-7000-8000-000000000202',
      }).success,
    ).toBe(true);
    expect(ownershipTransferBodySchema.safeParse({ toMembershipId: 'member-1' }).success).toBe(
      false,
    );
  });
});
