import { describe, expect, it } from 'vitest';
import { endingHeadline } from './game-ending';

const players = { white: 'Ada', black: 'Bea' };

describe('game ending headline', () => {
  it('names the winner and how they won', () => {
    expect(endingHeadline({ ...players, result: 'black_win', resultReason: 'checkmate' })).toBe(
      'Bea won by checkmate',
    );
    expect(endingHeadline({ ...players, result: 'white_win', resultReason: 'resign' })).toBe(
      'Bea resigned. Ada won',
    );
    expect(endingHeadline({ ...players, result: 'black_win', resultReason: 'flag' })).toBe(
      'Ada ran out of time. Bea won',
    );
  });

  it('says why a draw happened', () => {
    expect(endingHeadline({ ...players, result: 'draw', resultReason: 'agreement' })).toBe(
      'Drawn by agreement',
    );
    expect(endingHeadline({ ...players, result: 'draw', resultReason: 'stalemate' })).toBe(
      'Drawn by stalemate',
    );
  });

  it('falls back to the plain result when the reason is unknown', () => {
    expect(endingHeadline({ ...players, result: 'white_win' })).toBe('Ada won');
    expect(endingHeadline({ ...players, result: 'draw', resultReason: null })).toBe('Game drawn');
  });
});
