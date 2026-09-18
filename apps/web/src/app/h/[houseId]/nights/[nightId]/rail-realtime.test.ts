import type { NightRailSnapshotResponse } from '@between-moves/contracts';
import { describe, expect, it, vi } from 'vitest';
import { applyOrRepairNightRail } from './rail-realtime';

const snapshot: NightRailSnapshotResponse = {
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
      sequence: '1',
      currentFen: '8/8/8/8/4P3/8/8/8 b - - 0 1',
      currentPly: 1,
      sideToMove: 'black',
      lastSan: 'e4',
      white: { membershipId: '01941f29-7c00-7000-8000-000000000621', name: 'Ada' },
      black: { membershipId: '01941f29-7c00-7000-8000-000000000623', name: 'Bea' },
    },
  ],
  recentResults: [],
};

describe('Night rail realtime apply', () => {
  it('[BM-038] applies the next sequence and repairs a gap from a fresh read', async () => {
    const applied = await applyOrRepairNightRail(
      snapshot,
      {
        topic: 'game.move-accepted',
        aggregateId: '01941f29-7c00-7000-8000-000000000801',
        sequence: '2',
        payload: {
          ply: 2,
          san: 'e5',
          fenAfter: '8/8/8/4p3/4P3/8/8/8 w - - 0 2',
          sideToMove: 'white',
        },
      },
      async () => snapshot,
    );
    expect(applied.outcome).toBe('applied');
    expect(applied.snapshot.activeBoards[0]).toMatchObject({
      sequence: '2',
      lastSan: 'e5',
      sideToMove: 'white',
    });

    const repaired = { ...snapshot, nightSequence: '2', presenceCount: 0 };
    const readFresh = vi.fn(async () => repaired);
    const gap = await applyOrRepairNightRail(
      snapshot,
      {
        topic: 'game.move-accepted',
        aggregateId: '01941f29-7c00-7000-8000-000000000801',
        sequence: '9',
        payload: {
          ply: 9,
          san: 'Nf3',
          fenAfter: '8/8/8/8/8/5N2/8/8 b - - 1 5',
          sideToMove: 'black',
        },
      },
      readFresh,
    );
    expect(gap).toEqual({ snapshot: repaired, outcome: 'repaired' });
    expect(readFresh).toHaveBeenCalledOnce();
  });
});
