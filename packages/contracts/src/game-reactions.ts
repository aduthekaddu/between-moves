import { z } from 'zod';

/** [BM-031] [DR-REACT-01] Untrusted wire input for the closed Reaction set. */
export const gameReactionBodySchema = z
  .object({
    reaction: z.enum(['well_played', 'brilliant', 'dramatic', 'funny']),
  })
  .strict();

export type GameReactionBody = z.infer<typeof gameReactionBodySchema>;
