import { describe, expect, it } from 'vitest';
import { requireFen } from './board-model';
import { moveLabel, replayPositions } from './game-review';

const moves = [
  { ply: 1, uci: 'e2e4', san: 'e4' },
  { ply: 2, uci: 'e7e5', san: 'e5' },
];

describe('move labels', () => {
  it('numbers Moves the way the scoresheet does', () => {
    expect(moveLabel({ ply: 3, san: 'Nf3' })).toBe('2. Nf3');
    expect(moveLabel({ ply: 4, san: 'Nc6' })).toBe('2… Nc6');
  });
});

describe('game review replay', () => {
  it('gives the start and the position after every Move', () => {
    const positions = replayPositions(
      moves,
      requireFen('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'),
    );
    expect(positions?.map((fen) => fen.split(' ')[0])).toEqual([
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
      'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR',
    ]);
  });

  it('replays a promotion', () => {
    const line = ['a2a4', 'b7b5', 'a4b5', 'a7a6', 'b5a6', 'c8b7', 'a6b7', 'b8c6', 'b7a8q'].map(
      (uci, index) => ({ ply: index + 1, uci, san: '' }),
    );
    const positions = replayPositions(
      line,
      requireFen('Q2qkbnr/2pppppp/2n5/8/8/8/1PPPPPPP/RNBQKBNR b KQk - 0 5'),
    );
    expect(positions?.at(-1)?.split(' ')[0]).toBe('Q2qkbnr/2pppppp/2n5/8/8/8/1PPPPPPP/RNBQKBNR');
  });

  it('turns review off when the replay disagrees with the server board', () => {
    expect(replayPositions(moves, requireFen('8/8/8/8/8/8/8/8 w - - 0 1'))).toBeNull();
    expect(
      replayPositions([{ ply: 1, uci: 'e2e5', san: '?' }], requireFen('8/8/8/8/8/8/8/8 w - - 0 1')),
    ).toBeNull();
  });
});
