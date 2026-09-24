import { z } from 'zod';

const correspondenceClockPolicySchema = z
  .object({
    kind: z.literal('correspondence'),
    perMoveHours: z.number().int().positive().max(2_147_483_647),
  })
  .strict();

const liveClockPolicySchema = z
  .object({
    kind: z.literal('live'),
    initialMs: z.number().int().min(180_000).max(2_147_483_647),
    incrementMs: z.number().int().nonnegative().max(2_147_483_647),
  })
  .strict();

/** [BM-022] [DR-SEAT-01..02] Wire contract for correspondence seat creation. */
const common = {
  offeredColor: z.enum(['white', 'black', 'any']),
  intendedMembershipId: z.string().uuid().optional(),
};

export const createGameSeatBodySchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('correspondence'),
      clockPolicy: correspondenceClockPolicySchema,
      ...common,
    })
    .strict(),
  z
    .object({
      mode: z.literal('live'),
      nightId: z.string().uuid(),
      clockPolicy: liveClockPolicySchema,
      ...common,
    })
    .strict(),
]);

export type CreateGameSeatBody = z.infer<typeof createGameSeatBodySchema>;
