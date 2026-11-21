import { describe, expect, it } from 'vitest';
import { parseFenPieces } from './board-model';
import { materialBalance } from './material';

describe('material balance', () => {
  it('is level at the start', () => {
    expect(
      materialBalance(parseFenPieces('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')),
    ).toEqual({ white: { ahead: [], lead: 0 }, black: { ahead: [], lead: 0 } });
  });

  it('shows what each side is up and the points lead', () => {
    // White has taken a knight and a pawn; Black has taken a bishop.
    const balance = materialBalance(
      parseFenPieces('r1bqkbnr/ppp1pppp/8/8/8/8/PPPPPPPP/RN1QKBNR w KQkq - 0 1'),
    );
    expect(balance.white).toEqual({ ahead: ['knight', 'pawn'], lead: 1 });
    expect(balance.black).toEqual({ ahead: ['bishop'], lead: 0 });
  });

  it('counts a promoted queen as a queen', () => {
    const balance = materialBalance(parseFenPieces('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1'));
    expect(balance.white).toEqual({ ahead: ['queen'], lead: 9 });
  });
});
