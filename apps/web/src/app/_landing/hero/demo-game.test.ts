import { describe, expect, it } from 'vitest';
import { DEMO_GAME, START_POSITION, squareToXZ } from './demo-game';

describe('hero demo game', () => {
  it('sets all thirty-two pieces on distinct squares', () => {
    expect(START_POSITION).toHaveLength(32);
    expect(new Set(START_POSITION.map((piece) => piece.square)).size).toBe(32);
  });

  it('replays every move from an occupied square, ending in mate', () => {
    const board = new Map(START_POSITION.map((piece) => [piece.square, piece] as const));
    DEMO_GAME.forEach((move, ply) => {
      expect(move.uci).toMatch(/^[a-h][1-8][a-h][1-8]$/);
      const mover = board.get(move.uci.slice(0, 2));
      expect(mover?.color).toBe(ply % 2 === 0 ? 'white' : 'black');
      board.delete(move.uci.slice(0, 2));
      if (mover !== undefined) board.set(move.uci.slice(2, 4), mover);
    });
    expect(DEMO_GAME.at(-1)?.mate).toBe(true);
  });

  it('centres the board on the origin, one unit per square', () => {
    expect(squareToXZ('a1')).toEqual({ x: -3.5, z: 3.5 });
    expect(squareToXZ('h8')).toEqual({ x: 3.5, z: -3.5 });
  });
});
