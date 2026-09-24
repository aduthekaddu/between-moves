import { describe, expect, it, vi } from 'vitest';
import type { MoveEntryPosition } from '../move-entry-wire';
import { formatClock, remainingTime } from './countdown';

const position: MoveEntryPosition = {
  mode: 'live',
  currentFen: '',
  currentPly: 0,
  version: 0,
  sideToMove: 'white',
  state: 'active',
  viewerColor: 'white',
  white: { name: 'Ada' },
  black: { name: 'Bea' },
  moveDueAt: null,
  result: null,
  inCheck: false,
  moves: [],
  serverNow: '2026-09-24T12:00:10.000Z',
  liveClock: { whiteMs: 180_000, blackMs: 120_000, turnStartedAt: '2026-09-24T12:00:00.000Z' },
};

describe('[BM-042] server-anchored local countdown', () => {
  it('spends server elapsed time plus monotonic time on only the active side', () => {
    expect(remainingTime(position, 2500)).toEqual({ white: 167_500, black: 120_000 });
    expect(remainingTime({ ...position, sideToMove: 'black' }, 2500)).toEqual({
      white: 180_000,
      black: 107_500,
    });
  });
  it('ignores the device wall clock and catches up after delayed timer callbacks', () => {
    const wallClock = vi.spyOn(Date, 'now').mockReturnValue(0);
    try {
      expect(remainingTime(position, 65_000)).toEqual({ white: 105_000, black: 120_000 });
      expect(wallClock).not.toHaveBeenCalled();
    } finally {
      wallClock.mockRestore();
    }
  });
  it('reconciles to a replacement snapshot, including an earned increment', () => {
    const next = {
      ...position,
      sideToMove: 'black' as const,
      serverNow: '2026-09-24T12:00:20.000Z',
      liveClock: { whiteMs: 172_000, blackMs: 120_000, turnStartedAt: '2026-09-24T12:00:19.000Z' },
    };
    expect(remainingTime(next, 500)).toEqual({ white: 172_000, black: 118_500 });
  });
  it('clamps at zero without inventing a terminal result', () => {
    expect(remainingTime(position, 999_000)).toEqual({ white: 0, black: 120_000 });
    expect(position.state).toBe('active');
    expect(remainingTime(position, -1000)).toEqual({ white: 170_000, black: 120_000 });
  });
  it('stops completed clocks even when their last turn timestamp is present', () => {
    expect(remainingTime({ ...position, state: 'completed' }, 999_000)).toEqual({
      white: 180_000,
      black: 120_000,
    });
    expect(
      remainingTime(
        { ...position, liveClock: { ...position.liveClock!, turnStartedAt: null } },
        1000,
      ),
    ).toEqual({ white: 180_000, black: 120_000 });
  });
  it('does not render missing snapshots and never spends negative server elapsed time', () => {
    const withoutClock = { ...position };
    delete withoutClock.liveClock;
    const withoutServerTime = { ...position };
    delete withoutServerTime.serverNow;
    expect(remainingTime(withoutClock, 0)).toBeNull();
    expect(remainingTime(withoutServerTime, 0)).toBeNull();
    expect(remainingTime({ ...position, serverNow: '2026-09-24T11:00:00.000Z' }, 1000)).toEqual({
      white: 179_000,
      black: 120_000,
    });
  });
  it.each([
    [180_000, '3:00'],
    [60_001, '1:01'],
    [60_000, '1:00'],
    [1, '0:01'],
    [0, '0:00'],
    [-100, '0:00'],
    [3_600_000, '60:00'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatClock(ms as number)).toBe(expected);
  });
});
