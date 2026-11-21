import { describe, expect, it } from 'vitest';
import { parseFenPieces, squareName } from './board-model';

describe('correspondence board model', () => {
  it('[BM-027] [UX-A11Y-05] exposes piece and coordinate names from canonical FEN', () => {
    const pieces = parseFenPieces('8/8/8/8/8/8/4P3/8 w - - 0 1');

    expect(pieces.e2).toEqual({ color: 'white', kind: 'pawn' });
    expect(squareName('e2', pieces.e2)).toBe('e2, white pawn');
    expect(squareName('a8')).toBe('a8, empty');
  });
});
