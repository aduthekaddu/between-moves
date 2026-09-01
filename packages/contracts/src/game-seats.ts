import { z } from 'zod';

const correspondenceClockPolicySchema = z
  .object({
    kind: z.literal('correspondence'),
    perMoveHours: z.number().int().positive().max(2_147_483_647),
  })
  .strict();

/** [BM-022] [DR-SEAT-01..02] Wire contract for correspondence seat creation. */
export const createGameSeatBodySchema = z
  .object({
    mode: z.literal('correspondence'),
    clockPolicy: correspondenceClockPolicySchema,
    offeredColor: z.enum(['white', 'black', 'any']),
    intendedMembershipId: z.string().uuid().optional(),
  })
  .strict();

export type CreateGameSeatBody = z.infer<typeof createGameSeatBodySchema>;
