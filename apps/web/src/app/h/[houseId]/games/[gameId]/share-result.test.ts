import { describe, expect, it } from 'vitest';
import { shareResult } from './share-result';

const url = 'https://between-moves.example/h/h1/games/g1';

describe('shared result', () => {
  it('tells a short game move by move', () => {
    const moves = ['f3', 'e5', 'g4', 'Qh4#'].map((san, index) => ({
      ply: index + 1,
      uci: '',
      san,
    }));
    expect(shareResult({ headline: 'Asha won by checkmate', moves, url })).toBe(
      ['Asha won by checkmate in 2 moves.', '1. f3 e5 2. g4 Qh4#', `Between Moves · ${url}`].join(
        '\n',
      ),
    );
  });

  it('keeps a long game to its last move', () => {
    const moves = Array.from({ length: 41 }, (_, index) => ({
      ply: index + 1,
      uci: '',
      san: index === 40 ? 'Rxe8#' : 'a3',
    }));
    expect(shareResult({ headline: 'Ben won by checkmate', moves, url }).split('\n')).toEqual([
      'Ben won by checkmate in 21 moves.',
      'Last move: Rxe8#',
      `Between Moves · ${url}`,
    ]);
  });
});
