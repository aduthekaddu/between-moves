import { describe, expect, it } from 'vitest';
import { legalMoves, proposalSan } from './legal-moves';

const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('board legal-move hints', () => {
  it('lists each movable piece with its destinations', () => {
    const moves = legalMoves(start);
    expect([...(moves.get('e2') ?? new Map()).keys()]).toEqual(['e3', 'e4']);
    expect([...(moves.get('g1') ?? new Map()).keys()].sort()).toEqual(['f3', 'h3']);
    expect(moves.has('e1')).toBe(false);
    expect([...moves.values()].reduce((total, targets) => total + targets.size, 0)).toBe(20);
  });

  it('marks destinations that promote', () => {
    const moves = legalMoves('8/4P3/8/8/8/8/8/k6K w - - 0 1');
    expect(moves.get('e7')?.get('e8')).toBe(true);
    expect(moves.get('h1')?.get('g2')).toBe(false);
  });

  it('works on boards without kings, as the server allows', () => {
    expect([...(legalMoves('8/8/8/8/8/8/4P3/8 w - - 0 1').get('e2') ?? new Map()).keys()]).toEqual([
      'e3',
      'e4',
    ]);
  });

  it('offers nothing for a position it cannot read', () => {
    expect(legalMoves('not a position').size).toBe(0);
  });

  it('names a proposal the way the scoresheet will', () => {
    expect(proposalSan(start, { from: 'g1', to: 'f3' })).toBe('Nf3');
    expect(
      proposalSan('8/4P3/8/8/8/8/8/k6K w - - 0 1', { from: 'e7', to: 'e8', promotion: 'n' }),
    ).toBe('e8=N');
    expect(proposalSan(start, { from: 'e2', to: 'e5' })).toBeNull();
  });
});
