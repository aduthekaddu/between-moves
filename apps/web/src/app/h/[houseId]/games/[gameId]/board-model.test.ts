import { describe, expect, it } from 'vitest';
import { applyOptimisticMove, parseFenPieces, squareName } from './board-model';

describe('correspondence board model', () => {
  it('[BM-027] [UX-A11Y-05] exposes piece and coordinate names from canonical FEN', () => {
    const pieces = parseFenPieces('8/8/8/8/8/8/4P3/8 w - - 0 1');

    expect(pieces.e2).toEqual({ color: 'white', kind: 'pawn' });
    expect(squareName('e2', pieces.e2)).toBe('e2, white pawn');
    expect(squareName('a8')).toBe('a8, empty');
  });

  it('[BM-027] previews the proposal without claiming a browser-derived canonical FEN', () => {
    const pieces = parseFenPieces('8/8/8/8/8/8/4P3/8 w - - 0 1');

    const preview = applyOptimisticMove(pieces, { from: 'e2', to: 'e4' });

    expect(preview.e2).toBeUndefined();
    expect(preview.e4).toEqual({ color: 'white', kind: 'pawn' });
    expect(pieces.e2).toEqual({ color: 'white', kind: 'pawn' });
  });

  it('[BM-027] previews promotion, castling, and en passant proposals', () => {
    const promoted = applyOptimisticMove(parseFenPieces('8/P7/8/8/8/8/8/8 w - - 0 1'), {
      from: 'a7',
      to: 'a8',
      promotion: 'n',
    });
    const castled = applyOptimisticMove(parseFenPieces('8/8/8/8/8/8/8/4K2R w K - 0 1'), {
      from: 'e1',
      to: 'g1',
    });
    const enPassant = applyOptimisticMove(parseFenPieces('8/8/8/3pP3/8/8/8/8 w - d6 0 1'), {
      from: 'e5',
      to: 'd6',
    });

    expect(promoted.a8).toEqual({ color: 'white', kind: 'knight' });
    expect(castled.f1).toEqual({ color: 'white', kind: 'rook' });
    expect(castled.h1).toBeUndefined();
    expect(enPassant.d5).toBeUndefined();
  });
});
