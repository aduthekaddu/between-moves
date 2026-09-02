import { describe, expect, it } from 'vitest';
import { ChessJsRulesAdapter } from './chess-js-rules-adapter';

const adapter = new ChessJsRulesAdapter();
const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('ChessJsRulesAdapter contract', () => {
  it.each([
    {
      name: 'an ordinary legal move',
      fen: standardFen,
      move: { from: 'e2', to: 'e4' } as const,
      expected: {
        legal: true,
        uci: 'e2e4',
        san: 'e4',
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
        sideToMove: 'black',
        ply: 1,
        terminalState: 'ongoing',
        terminalReason: null,
      },
    },
    {
      name: 'checkmate',
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2',
      move: { from: 'd8', to: 'h4' } as const,
      expected: {
        legal: true,
        uci: 'd8h4',
        san: 'Qh4#',
        fen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
        sideToMove: 'white',
        ply: 4,
        terminalState: 'checkmate',
        terminalReason: 'checkmate',
      },
    },
    {
      name: 'stalemate',
      fen: 'k7/2Q5/2K5/8/8/8/8/8 w - - 0 1',
      move: { from: 'c7', to: 'b6' } as const,
      expected: {
        legal: true,
        uci: 'c7b6',
        san: 'Qb6',
        fen: 'k7/8/1QK5/8/8/8/8/8 b - - 1 1',
        sideToMove: 'black',
        ply: 1,
        terminalState: 'stalemate',
        terminalReason: 'stalemate',
      },
    },
    {
      name: 'draw by insufficient material',
      fen: 'k7/1R6/8/3K4/8/8/8/8 b - - 0 1',
      move: { from: 'a8', to: 'b7' } as const,
      expected: {
        legal: true,
        uci: 'a8b7',
        san: 'Kxb7',
        fen: '8/1k6/8/3K4/8/8/8/8 w - - 0 2',
        sideToMove: 'white',
        ply: 2,
        terminalState: 'draw',
        terminalReason: 'insufficient_material',
      },
    },
  ])('[BM-021] [DR-GAME-04] returns canonical truth for $name', ({ fen, move, expected }) => {
    expect(adapter.applyMove(fen, move, [])).toEqual(expected);
  });

  it('[BM-021] [DR-GAME-04] detects a third canonical position occurrence', () => {
    const firstOccurrence = standardFen;
    const secondOccurrence = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 4 3';
    const fenBeforeFinalMove = 'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 7 4';

    expect(
      adapter.applyMove(fenBeforeFinalMove, { from: 'f6', to: 'g8' }, [
        firstOccurrence,
        secondOccurrence,
        fenBeforeFinalMove,
      ]),
    ).toEqual({
      legal: true,
      uci: 'f6g8',
      san: 'Ng8',
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 8 5',
      sideToMove: 'white',
      ply: 8,
      terminalState: 'draw',
      terminalReason: 'repetition',
    });
  });

  it('[BM-021] [DR-MOVE-02] rejects an illegal move without deriving a position', () => {
    expect(adapter.applyMove(standardFen, { from: 'e2', to: 'e5' }, [standardFen])).toEqual({
      legal: false,
      reason: 'illegal_move',
    });
  });

  it('[BM-021] [DR-GAME-04] rejects an invalid canonical FEN', () => {
    expect(adapter.applyMove('not-a-fen', { from: 'e2', to: 'e4' }, [])).toEqual({
      legal: false,
      reason: 'invalid_fen',
    });
  });
});
