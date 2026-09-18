import { HouseAuthorizationDeniedError, type NightRailSnapshot } from '@between-moves/domain';
import { createRealtimeMetricStubs, createStructuredLogger } from '@between-moves/observability';
import { describe, expect, it, vi } from 'vitest';
import { createNightRailReader } from './rail';

const houseId = '01941f29-7c00-7000-8000-000000000601';
const nightId = '01941f29-7c00-7000-8000-000000000901';
const viewer = {
  kind: 'authenticated' as const,
  userId: '01941f29-7c00-7000-8000-000000000611',
  displayName: 'Ada',
  imageUrl: null,
};
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
  presenceCount: 2,
  activeBoards: [],
  recentResults: [],
};
const now = new Date('2026-09-04T14:05:00.000Z');

describe('Night rail request seam', () => {
  it('[BM-038] logs a PII-free rail view and counts gap repairs', async () => {
    const lines: string[] = [];
    const metrics = createRealtimeMetricStubs();
    const reader = createNightRailReader({
      getViewer: vi.fn(async () => viewer),
      readNightRail: vi.fn(async () => snapshot),
      logger: createStructuredLogger({
        clock: { now: () => now },
        sink: (line) => lines.push(line),
      }),
      metrics,
      clock: { now: () => now },
    });

    await expect(
      reader(
        new Request(`https://betweenmoves.test/h/${houseId}/nights/${nightId}?repair=1`, {
          headers: { 'x-request-id': 'bm-038-rail' },
        }),
        houseId,
        nightId,
      ),
    ).resolves.toEqual(snapshot);
    expect(metrics.snapshot().live_reconnect_total).toBe(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      house_id: houseId,
      event: 'night.rail-repaired',
      data: { night_id: nightId, presence_count: 2 },
    });
    expect(lines[0]).not.toContain(viewer.displayName);
  });

  it('[BM-038] [DR-SEC-01] hides House authorization denials', async () => {
    const logger = { log: vi.fn() };
    const reader = createNightRailReader({
      getViewer: vi.fn(async () => viewer),
      readNightRail: vi.fn(async () => {
        throw new HouseAuthorizationDeniedError('not_a_member', true);
      }),
      logger,
      metrics: createRealtimeMetricStubs(),
      clock: { now: () => now },
    });

    await expect(
      reader(
        new Request(`https://betweenmoves.test/h/${houseId}/nights/${nightId}`),
        houseId,
        nightId,
      ),
    ).resolves.toBeNull();
    expect(logger.log).not.toHaveBeenCalled();
  });
});
