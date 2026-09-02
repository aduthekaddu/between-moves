import { z } from 'zod';

const chessSquareSchema = z.string().regex(/^[a-h][1-8]$/);

/** [BM-024] [DR-SEC-03] Untrusted wire input for the durable Move command. */
export const submitMoveBodySchema = z
  .object({
    expectedPly: z.number().int().nonnegative().max(2_147_483_647),
    clientCommandId: z.string().uuidv7(),
    move: z
      .object({
        from: chessSquareSchema,
        to: chessSquareSchema,
        promotion: z.enum(['q', 'r', 'b', 'n']).optional(),
      })
      .strict(),
  })
  .strict();

export type SubmitMoveBody = z.infer<typeof submitMoveBodySchema>;
