import { describe, expect, it } from 'vitest';
import { gameNoteBodySchema } from './game-notes';

describe('Game note contract', () => {
  it('[BM-032] [DR-NOTE-01] accepts 1..2000 plain-text characters', () => {
    expect(gameNoteBodySchema.parse({ body: '<script>alert(1)</script>' })).toEqual({
      body: '<script>alert(1)</script>',
    });
    expect(gameNoteBodySchema.safeParse({ body: '' }).success).toBe(false);
    expect(gameNoteBodySchema.safeParse({ body: 'a'.repeat(2_000) }).success).toBe(true);
    expect(gameNoteBodySchema.safeParse({ body: 'a'.repeat(2_001) }).success).toBe(false);
    expect(gameNoteBodySchema.safeParse({ body: '♟️'.repeat(1_000) }).success).toBe(true);
    expect(gameNoteBodySchema.safeParse({ body: '😀'.repeat(2_000) }).success).toBe(true);
    expect(gameNoteBodySchema.safeParse({ body: '😀'.repeat(2_001) }).success).toBe(false);
  });
});
