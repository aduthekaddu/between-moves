import { describe, expect, it } from 'vitest';
import { acceptedMove, conflictPosition, flagFall, moveEntryPosition } from './move-entry-wire';

describe('Move-entry wire responses', () => {
  it('[BM-041] recognizes a flag result without treating it as an accepted Move', () => {
    const flagged = {
      state: 'completed',
      result: 'black_win',
      resultReason: 'flag',
      ply: 0,
      clock: { whiteMs: 0, blackMs: 300_000, turnStartedAt: null },
    };
    expect(flagFall(flagged)).toBe(true);
    expect(acceptedMove(flagged)).toBeNull();
    expect(flagFall({ ...flagged, resultReason: 'checkmate' })).toBe(false);
  });

  it('[BM-027] accepts canonical submitMove and conflict shapes', () => {
    expect(
      acceptedMove({
        ply: 1,
        uci: 'e2e4',
        san: 'e4',
        fenAfter: '8/8/8/8/4P3/8/8/8 b - - 0 1',
        sideToMove: 'black',
        version: 1,
      }),
    ).toMatchObject({ ply: 1, uci: 'e2e4', version: 1 });
    expect(
      conflictPosition({
        code: 'move_conflict',
        meta: { version: 2, currentPly: 2, fen: '8/8/8/8/4P3/8/8/8 w - - 0 2' },
      }),
    ).toMatchObject({ version: 2, currentPly: 2, sideToMove: 'white' });
  });

  it('[BM-027] accepts a complete repair snapshot and rejects partial state', () => {
    const snapshot = {
      currentFen: '8/8/8/8/4P3/8/8/8 b - - 0 1',
      currentPly: 1,
      sideToMove: 'black',
      version: 1,
      state: 'active',
      viewerColor: 'white',
      white: { name: 'Ada' },
      black: { name: 'Bea' },
      moveDueAt: '2026-09-10T08:00:00.000Z',
      result: null,
      inCheck: false,
      moves: [{ ply: 1, uci: 'e2e4', san: 'e4' }],
    };

    expect(moveEntryPosition(snapshot)).toMatchObject(snapshot);
    expect(moveEntryPosition({ ...snapshot, inCheck: undefined })).toBeNull();
    expect(moveEntryPosition({ ...snapshot, moves: [{ ply: 'one' }] })).toBeNull();
  });
});

describe('[BM-042] live snapshot validation', () => {
  const snapshot = {
    mode: 'live',
    serverNow: '2026-09-24T12:00:10.000Z',
    currentFen: '8/8/8/8/4P3/8/8/8 b - - 0 1',
    currentPly: 1,
    sideToMove: 'black',
    version: 1,
    state: 'active',
    viewerColor: 'white',
    white: { name: 'Ada' },
    black: { name: 'Bea' },
    moveDueAt: null,
    result: null,
    inCheck: false,
    moves: [],
    liveClock: { whiteMs: 180_000, blackMs: 180_000, turnStartedAt: '2026-09-24T12:00:00.000Z' },
  };
  it('preserves the server clock anchor and completed balances', () => {
    expect(moveEntryPosition(snapshot)).toEqual(snapshot);
    expect(
      moveEntryPosition({
        ...snapshot,
        state: 'completed',
        liveClock: { ...snapshot.liveClock, turnStartedAt: null },
      }),
    ).not.toBeNull();
  });
  it.each([
    { serverNow: undefined },
    { serverNow: 'invalid' },
    { liveClock: undefined },
    { liveClock: null },
    ...[-1, NaN, Infinity, 0.5].map((whiteMs) => ({
      liveClock: { ...snapshot.liveClock, whiteMs },
    })),
    { liveClock: { ...snapshot.liveClock, blackMs: -1 } },
    { liveClock: { ...snapshot.liveClock, turnStartedAt: 'invalid' } },
    { liveClock: { ...snapshot.liveClock, turnStartedAt: null } },
  ])('rejects unsafe or incomplete clock state: %j', (patch) => {
    expect(moveEntryPosition({ ...snapshot, ...patch })).toBeNull();
  });
});
