import { describe, expect, it } from 'vitest';
import { boardStatus } from './board-status';
import type { MoveEntryPosition } from './move-entry-wire';

const position: MoveEntryPosition = {
  currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  currentPly: 0,
  sideToMove: 'white',
  version: 0,
  state: 'active',
  viewerColor: 'white',
  white: { name: 'Ada' },
  black: { name: 'Bea' },
  moveDueAt: null,
  result: null,
  inCheck: false,
  moves: [],
};
const flags = { fresh: true, narrowLive: false, pending: false };

describe('board status', () => {
  it('tells the player whose move it is', () => {
    expect(boardStatus({ position, ...flags })).toEqual({ headline: 'Your move', tone: 'yours' });
    expect(boardStatus({ position: { ...position, viewerColor: 'black' }, ...flags })).toEqual({
      headline: 'Waiting on Ada',
      tone: 'waiting',
    });
    expect(boardStatus({ position: { ...position, viewerColor: null }, ...flags })).toEqual({
      headline: 'Ada to move',
      tone: 'quiet',
    });
  });

  it('says how it ended, from the reader’s side', () => {
    const finished = {
      ...position,
      state: 'completed' as const,
      result: 'black_win' as const,
      resultReason: 'checkmate' as const,
    };
    expect(boardStatus({ position: finished, ...flags })).toEqual({
      headline: 'Bea won by checkmate',
      tone: 'lost',
    });
    expect(boardStatus({ position: { ...finished, viewerColor: 'black' }, ...flags })).toEqual({
      headline: 'You won by checkmate',
      tone: 'won',
    });
    expect(
      boardStatus({
        position: { ...finished, result: 'draw', resultReason: 'agreement' },
        ...flags,
      }),
    ).toEqual({ headline: 'Drawn by agreement', tone: 'drawn' });
  });

  it('puts a stale board ahead of whose move it is', () => {
    expect(boardStatus({ position, ...flags, fresh: false }).headline).toBe('Refreshing the board');
  });
});
