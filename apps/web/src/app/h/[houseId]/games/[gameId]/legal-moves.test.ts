import { describe, expect, it } from 'vitest';
import { parseFenPieces, requireFen } from './board-model';
import { legalMoves, proposalOutcome, turnState } from './legal-moves';

const start = requireFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

describe('board legal-move hints', () => {
  it('lists each movable piece with its destinations', () => {
    const moves = legalMoves(start);
    expect([...(moves.get('e2') ?? new Map()).keys()]).toEqual(['e3', 'e4']);
    expect([...(moves.get('g1') ?? new Map()).keys()].sort()).toEqual(['f3', 'h3']);
    expect(moves.has('e1')).toBe(false);
    expect([...moves.values()].reduce((total, targets) => total + targets.size, 0)).toBe(20);
  });

  it('marks destinations that promote', () => {
    const moves = legalMoves(requireFen('8/4P3/8/8/8/8/8/k6K w - - 0 1'));
    expect(moves.get('e7')?.get('e8')).toBe(true);
    expect(moves.get('h1')?.get('g2')).toBe(false);
  });

  it('works on boards without kings, as the server allows', () => {
    expect([...(legalMoves(requireFen('8/8/8/8/8/8/4P3/8 w - - 0 1')).get('e2') ?? new Map()).keys()]).toEqual([
      'e3',
      'e4',
    ]);
  });

  it('names a proposal the way the scoresheet will', () => {
    expect(proposalOutcome(start, { from: 'g1', to: 'f3' })?.san).toBe('Nf3');
    expect(
      proposalOutcome(requireFen('8/4P3/8/8/8/8/8/k6K w - - 0 1'), { from: 'e7', to: 'e8', promotion: 'n' })
        ?.san,
    ).toBe('e8=N');
    expect(proposalOutcome(start, { from: 'e2', to: 'e5' })).toBeNull();
  });

  it('[BM-027] previews promotion, castling, and en passant proposals', () => {
    const after = (fen: string, proposal: Parameters<typeof proposalOutcome>[1]) =>
      parseFenPieces(proposalOutcome(requireFen(fen), proposal)?.fen ?? fen);
    const promoted = after('7k/P7/8/8/8/8/8/K7 w - - 0 1', {
      from: 'a7',
      to: 'a8',
      promotion: 'n',
    });
    const castled = after('k7/8/8/8/8/8/8/4K2R w K - 0 1', { from: 'e1', to: 'g1' });
    const enPassant = after('k7/8/8/3pP3/8/8/8/K7 w - d6 0 1', { from: 'e5', to: 'd6' });

    expect(promoted.a8).toEqual({ color: 'white', kind: 'knight' });
    expect(castled.f1).toEqual({ color: 'white', kind: 'rook' });
    expect(castled.h1).toBeUndefined();
    expect(enPassant.d5).toBeUndefined();
  });

  it('reads who moves next and whether they are in check', () => {
    expect(turnState(start)).toEqual({ sideToMove: 'white', inCheck: false });
    expect(turnState(requireFen('4k3/8/8/8/8/8/8/R3K3 b - - 0 1'))).toEqual({
      sideToMove: 'black',
      inCheck: false,
    });
    expect(turnState(requireFen('R3k3/8/8/8/8/8/8/4K3 b - - 0 1'))).toEqual({
      sideToMove: 'black',
      inCheck: true,
    });
  });
});
