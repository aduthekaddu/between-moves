import type { NightRailSnapshot } from '@between-moves/domain';
import { describe, expect, it } from 'vitest';
import { parseNightRailSnapshot, serializeNightRailSnapshot } from './rail-snapshot';

const snapshot: NightRailSnapshot = {
  houseId: '01941f29-7c00-7000-8000-000000000201',
  nightId: '01941f29-7c00-7000-8000-000000000901',
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  state: 'live',
  scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
  scheduledEnd: new Date('2026-09-04T16:00:00.000Z'),
  startedAt: new Date('2026-09-04T14:00:00.000Z'),
  endedAt: null,
  nightSequence: 1n,
  presence: [
    {
      clientId: '01941f29-7c00-7000-8000-000000000101',
      displayName: 'Ada',
      signature: 'a'.repeat(43),
    },
    {
      clientId: '01941f29-7c00-7000-8000-000000000102',
      displayName: 'Bea',
      signature: 'b'.repeat(43),
    },
  ],
  presenceCount: 2,
  activeBoards: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000801',
      sequence: 2n,
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

describe('Night rail snapshot codec', () => {
  it('[BM-038] round-trips decimal sequences and instants', () => {
    const encoded = serializeNightRailSnapshot(snapshot);
    expect(encoded.nightSequence).toBe('1');
    expect(encoded.activeBoards[0]?.sequence).toBe('2');
    expect(parseNightRailSnapshot(encoded)).toEqual(snapshot);
  });
});
