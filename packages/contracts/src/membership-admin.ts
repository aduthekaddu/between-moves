import { z } from 'zod';

/** [BM-015] Wire contracts for membership administration commands. */
export const membershipRoleChangeBodySchema = z
  .object({ role: z.enum(['member', 'steward']) })
  .strict();

export const ownershipTransferBodySchema = z.object({ toMembershipId: z.string().uuid() }).strict();
