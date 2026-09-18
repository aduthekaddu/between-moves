import type { NightRailSnapshotResponse } from '@between-moves/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NightRailView } from './night-rail-view';

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
      sequence: '1',
      currentFen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      currentPly: 1,
      sideToMove: 'black',
      lastSan: 'e4',
      white: { membershipId: '01941f29-7c00-7000-8000-000000000621', name: 'Ada' },
      black: { membershipId: '01941f29-7c00-7000-8000-000000000623', name: 'Bea' },
    },
  ],
  recentResults: [
    {
      gameId: '01941f29-7c00-7000-8000-000000000802',
      sequence: '3',
      result: 'white_win',
      resultReason: 'resign',
      completedAt: '2026-09-04T14:20:00.000Z',
      white: { membershipId: '01941f29-7c00-7000-8000-000000000621', name: 'Ada' },
      black: { membershipId: '01941f29-7c00-7000-8000-000000000623', name: 'Bea' },
    },
  ],
};

describe('Night rail view', () => {
  it('[BM-038] renders durable boards and results before realtime attaches', () => {
    const html = renderToStaticMarkup(
      <NightRailView
        houseId="01941f29-7c00-7000-8000-000000000201"
        initial={snapshot}
        attachRealtime={false}
      />,
    );

    expect(html).toContain('The rail');
    expect(html).toContain('Showing the last saved table.');
    expect(html).not.toContain('Live updates are on.');
    expect(html).toContain('2 members at the table');
    expect(html).toContain('Here now');
    expect(html).toContain('Ada');
    expect(html).toContain('Bea');
    expect(html).toContain('e4');
    expect(html).toContain('Ada won');
    expect(html).toContain('role="img"');
    expect(html).toContain('Boards in play');
    expect(html).toContain('Recent results');
  });
});
