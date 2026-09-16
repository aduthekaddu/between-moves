import { describe, expect, it } from 'vitest';
import { gameReactionBodySchema } from './game-reactions';

describe('BM-031 Game Reaction contract', () => {
  it('[BM-031] [DR-REACT-01] accepts only the closed Reaction set', () => {
    for (const reaction of ['well_played', 'brilliant', 'dramatic', 'funny']) {
      expect(gameReactionBodySchema.safeParse({ reaction }).success).toBe(true);
    }
    expect(gameReactionBodySchema.safeParse({ reaction: 'heart' }).success).toBe(false);
    expect(gameReactionBodySchema.safeParse({ reaction: 'funny', note: 'extra' }).success).toBe(
      false,
    );
  });
});
