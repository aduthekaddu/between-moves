import { z } from 'zod';

const clientCommandIdSchema = z.string().uuidv7();

/** [BM-028] Untrusted wire input for an idempotent resignation. */
export const resignGameBodySchema = z.object({ clientCommandId: clientCommandIdSchema }).strict();

/** [BM-028] [DR-DRAW-02] Untrusted wire input for the draw-offer lifecycle. */
export const drawGameBodySchema = z
  .object({
    action: z.enum(['offer', 'accept']),
    clientCommandId: clientCommandIdSchema,
  })
  .strict();

export type ResignGameBody = z.infer<typeof resignGameBodySchema>;
export type DrawGameBody = z.infer<typeof drawGameBodySchema>;
