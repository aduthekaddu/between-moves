import { describe, expect, it } from 'vitest';
import { fenToPieces, isDark, squaresFromWhite } from './mini-board';

describe('mini board', () => {
  it('maps a FEN placement to coloured pieces by square', () => {
    const pieces = fenToPieces('6k1/5ppp/8/8/8/8/2r2PPP/3R2K1 w - - 0 1');
    expect(pieces.g8).toBe('black-king');
    expect(pieces.d1).toBe('white-rook');
    expect(pieces.c2).toBe('black-rook');
    expect(Object.keys(pieces)).toHaveLength(10);
  });

  it('colours a1 dark and h1 light', () => {
    expect(isDark('a1')).toBe(true);
    expect(isDark('h1')).toBe(false);
    expect(isDark('h8')).toBe(true);
  });

  it('lists squares from White’s side, a8 first and h1 last', () => {
    const squares = squaresFromWhite();
    expect(squares).toHaveLength(64);
    expect(squares[0]).toBe('a8');
    expect(squares[63]).toBe('h1');
  });
});
