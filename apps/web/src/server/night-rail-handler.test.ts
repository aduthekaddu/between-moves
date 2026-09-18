import type { NightRailSnapshot } from '@between-moves/domain';
import { describe, expect, it, vi } from 'vitest';
import { createReadNightRailHandler } from './night-rail-handler';

const houseId = '01941f29-7c00-7000-8000-000000000201';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const snapshot: NightRailSnapshot = {
  houseId,
  nightId,
  seasonId: '01941f29-7c00-7000-8000-000000000701',
  state: 'live',
  scheduledStart: new Date('2026-09-04T14:00:00.000Z'),
  scheduledEnd: new Date('2026-09-04T16:00:00.000Z'),
  startedAt: new Date('2026-09-04T14:00:00.000Z'),
  endedAt: null,
  nightSequence: 1n,
  presenceCount: 3,
  activeBoards: [],
  recentResults: [],
};

describe('Night rail handler', () => {
  it('[BM-038] returns the durable snapshot before any realtime attach', async () => {
    const readNightRail = vi.fn(async () => snapshot);
    const response = await createReadNightRailHandler({ readNightRail })(
      new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}/rail`),
      houseId,
      nightId,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      nightId,
      nightSequence: '1',
      presenceCount: 3,
      activeBoards: [],
    });
    expect(readNightRail).toHaveBeenCalledOnce();
  });

  it('[BM-038] [DR-SEC-01] hides an unauthorized or missing Night as not found', async () => {
    const response = await createReadNightRailHandler({ readNightRail: async () => null })(
      new Request(`https://app.example.test/api/houses/${houseId}/nights/${nightId}/rail`),
      houseId,
      nightId,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'not_found' });
  });
});
