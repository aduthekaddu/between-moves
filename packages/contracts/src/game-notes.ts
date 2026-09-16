import { z } from 'zod';

/** [BM-032] [DR-NOTE-01] Bounded plain-text Game note wire input. */
export const gameNoteBodySchema = z
  .object({
    body: z
      .string()
      .min(1)
      .refine((value) => [...value].length <= 2_000),
  })
  .strict();

export type GameNoteBody = z.infer<typeof gameNoteBodySchema>;
