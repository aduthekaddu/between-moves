import { describe, expect, it } from 'vitest';
import { nightRailSnapshotSchema } from './night-rail';

const valid = {
  houseId: '01941f29-7c00-7000-8000-000000000201',
  nightId: '01941f29-7c00-7000-8000-000000000901',
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  state: 'live',
  scheduledStart: '2026-09-04T14:00:00.000Z',
  scheduledEnd: '2026-09-04T16:00:00.000Z',
  startedAt: '2026-09-04T14:00:00.000Z',
  endedAt: null,
  nightSequence: '1',
  presenceCount: 2,
  activeBoards: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000801',
      sequence: '2',
      currentFen: '8/8/8/8/8/8/8/8 w - - 0 1',
      currentPly: 2,
      sideToMove: 'white',
      lastSan: 'e5',
      white: { membershipId: '01941f29-7c00-7000-8000-000000000621', name: 'Ada' },
      black: { membershipId: '01941f29-7c00-7000-8000-000000000623', name: 'Bea' },
    },
  ],
  recentResults: [],
};

describe('Night rail snapshot contract', () => {
  it('[BM-038] accepts a durable rail snapshot and rejects extra fields', () => {
    expect(nightRailSnapshotSchema.parse(valid)).toEqual(valid);
    expect(nightRailSnapshotSchema.safeParse({ ...valid, serverKey: 'secret' }).success).toBe(
      false,
    );
    expect(nightRailSnapshotSchema.safeParse({ ...valid, nightSequence: 1 }).success).toBe(false);
  });
});
